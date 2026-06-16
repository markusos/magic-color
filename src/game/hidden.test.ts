import { describe, it, expect } from 'vitest';
import {
  cappedSolveMoves,
  computeHidden,
  emptyGrid,
  exposableCells,
  isCapped,
  knownTopRun,
  revealExposed,
} from './hidden';
import { generateForLevel } from './progression';
import type { GameState, Move } from './types';

const board = (bottles: string[][]): GameState => ({ bottles, capacity: 4 });
/** All cells eligible (full grid of true), for selection-focused tests. */
const allExposable = (state: GameState) => state.bottles.map((b) => b.map(() => true));

describe('exposableCells', () => {
  it('marks cells the solution surfaces and nothing else', () => {
    // Bottle 0 fully empties into 1; so both of its cells are exposed. Bottle 1 only grows.
    const state = board([['ruby', 'ruby'], []]);
    const solution: Move[] = [{ from: 0, to: 1, count: 2, color: 'ruby' }];
    const grid = exposableCells(state, solution);
    expect(grid[0]).toEqual([true, true]); // emptied -> both surfaced
    expect(grid[1]).toEqual([]); // started empty, only received
  });

  it('marks nothing when the solution never pours from a bottle', () => {
    const state = board([['ruby', 'amber', 'teal']]);
    expect(exposableCells(state, [])).toEqual([[false, false, false]]);
  });
});

describe('computeHidden', () => {
  it('never conceals the top segment and only touches the bottom 3 layers', () => {
    const state = board([
      ['ruby', 'amber', 'teal', 'lime'],
      ['rose', 'rose', 'rose', 'rose'],
      [],
    ]);
    const grid = computeHidden(state, 12345, allExposable(state));
    for (let b = 0; b < state.bottles.length; b++) {
      const bottle = state.bottles[b]!;
      if (bottle.length === 0) {
        expect(grid[b]).toEqual([]);
        continue;
      }
      expect(grid[b]![bottle.length - 1]).toBe(false); // top never concealed
    }
  });

  it('only conceals cells flagged exposable', () => {
    const state = board([['ruby', 'amber', 'teal', 'lime']]);
    const noneExposable = state.bottles.map((b) => b.map(() => false));
    expect(computeHidden(state, 7, noneExposable)).toEqual([[false, false, false, false]]);
  });

  it('is deterministic for a given seed and varies by seed', () => {
    const state = board([['ruby', 'amber', 'teal', 'lime']]);
    const ex = allExposable(state);
    expect(computeHidden(state, 7, ex)).toEqual(computeHidden(state, 7, ex));
    expect(computeHidden(state, 7, ex)).not.toEqual(computeHidden(state, 8, ex));
  });
});

describe('knownTopRun', () => {
  it('counts the same-color top run but stops at a concealed cell', () => {
    // [red, red, red] all the same; concealing index 1 caps the visible run at 2 (indices 2..1? no).
    const bottle = ['ruby', 'ruby', 'ruby'];
    expect(knownTopRun(bottle, [false, false, false])).toBe(3);
    expect(knownTopRun(bottle, [false, true, false])).toBe(1); // concealed just below top
    expect(knownTopRun(bottle, [true, false, false])).toBe(2); // concealed at the bottom
  });

  it('stops at a color change like the normal top run', () => {
    expect(knownTopRun(['amber', 'ruby', 'ruby'], [false, false, false])).toBe(2);
  });

  it('is 0 for an empty bottle', () => {
    expect(knownTopRun([], [])).toBe(0);
  });
});

describe('revealExposed', () => {
  it('reveals a concealed cell once it becomes the top, and is sticky', () => {
    // Bottle of 3 with index 1 concealed; after the top is removed, index 1 is exposed.
    const hidden = [[false, true, false]];
    const full = board([['ruby', 'amber', 'teal']]);
    expect(revealExposed(full, hidden)).toBe(hidden); // index 1 still buried -> no change

    const popped = board([['ruby', 'amber']]); // top removed; index 1 now on top
    const revealed = revealExposed(popped, hidden);
    expect(revealed[0]![1]).toBe(false); // concealed bit cleared

    // Re-burying (geometry grows again) keeps it revealed because the bit is already cleared.
    const reburied = board([['ruby', 'amber', 'sapphire']]);
    expect(revealExposed(reburied, revealed)[0]![1]).toBe(false);
  });

  it('does NOT reveal a concealed cell just because its tube is a full single color', () => {
    // [ruby, ruby, ruby, ruby] is physically complete, but index 1 must still be surfaced.
    const hidden = [[false, true, false, false]];
    const complete = board([['ruby', 'ruby', 'ruby', 'ruby']]);
    expect(revealExposed(complete, hidden)[0]![1]).toBe(true); // stays concealed
  });
});

describe('cappedSolveMoves', () => {
  it('equals the bulk solution length when nothing is concealed', () => {
    const lvl = generateForLevel(1); // chapter 0 — no hidden
    expect(cappedSolveMoves(lvl.state, lvl.solution, lvl.hidden)).toBe(lvl.solution.length);
  });

  it('is at least the bulk length on a hidden level and matches the level optimal', () => {
    // Capping can only split runs, never merge them, so it never undercounts the bulk solution.
    for (const level of [75, 90, 120, 145]) {
      const lvl = generateForLevel(level); // chapter 1 — hidden
      const capped = cappedSolveMoves(lvl.state, lvl.solution, lvl.hidden);
      expect(capped).toBeGreaterThanOrEqual(lvl.solution.length);
      expect(lvl.optimal).toBe(capped); // exactly what the level exposes as `optimal`
    }
  });
});

describe('isCapped', () => {
  it('caps a full single-color, fully-revealed tube', () => {
    expect(isCapped(['ruby', 'ruby', 'ruby', 'ruby'], 4)).toBe(true);
    expect(isCapped(['ruby', 'ruby', 'ruby', 'ruby'], 4, [false, false, false, false])).toBe(true);
  });

  it('does not cap a full single-color tube that still hides a cell', () => {
    expect(isCapped(['ruby', 'ruby', 'ruby', 'ruby'], 4, [false, true, false, false])).toBe(false);
  });

  it('does not cap partial, mixed, or empty tubes', () => {
    expect(isCapped(['ruby', 'ruby'], 4)).toBe(false); // not full
    expect(isCapped(['ruby', 'amber', 'ruby', 'ruby'], 4)).toBe(false); // mixed
    expect(isCapped([], 4)).toBe(false); // empty
  });
});

describe('emptyGrid', () => {
  it('matches the board shape and conceals nothing', () => {
    const grid = emptyGrid(board([['ruby', 'amber'], []]));
    expect(grid).toEqual([[false, false], []]);
  });
});
