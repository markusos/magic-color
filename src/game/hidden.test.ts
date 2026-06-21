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
import { nearOptimalCutoffs, optimalCappedMoves } from './search';
import { generateForLevel } from './levelLoader';
import { generateLevel } from './generator';
import { bfsOptimal } from './solver';
import type { GameState, Move } from './types';
import { board, color, tube } from '../test/board';

/** All cells eligible (full grid of true), for selection-focused tests. */
const allExposable = (state: GameState) => state.bottles.map((b) => b.map(() => true));

describe('exposableCells', () => {
  it('marks cells the solution surfaces and nothing else', () => {
    // Bottle 0 fully empties into 1; so both of its cells are exposed. Bottle 1 only grows.
    const state = board([['ruby', 'ruby'], []]);
    const solution: Move[] = [{ from: 0, to: 1, count: 2, color: color('ruby') }];
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
    const bottle = tube(['ruby', 'ruby', 'ruby']);
    expect(knownTopRun(bottle, [false, false, false])).toBe(3);
    expect(knownTopRun(bottle, [false, true, false])).toBe(1); // concealed just below top
    expect(knownTopRun(bottle, [true, false, false])).toBe(2); // concealed at the bottom
  });

  it('stops at a color change like the normal top run', () => {
    expect(knownTopRun(tube(['amber', 'ruby', 'ruby']), [false, false, false])).toBe(2);
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

  it('is at least the bulk length on a hidden level (runs only split, never merge)', () => {
    for (const level of [75, 90, 120, 145]) {
      const lvl = generateForLevel(level); // chapter 1 — hidden
      const capped = cappedSolveMoves(lvl.state, lvl.solution, lvl.hidden);
      expect(capped).toBeGreaterThanOrEqual(lvl.solution.length);
    }
  });
});

describe('optimalCappedMoves', () => {
  // Sizes are set explicitly here (not via campaign level numbers) so the cases stay valid
  // regardless of which shapes the campaign happens to place at a given level.
  it('equals the exact bulk optimum on small non-hidden boards', () => {
    for (const seed of [1, 2, 3]) {
      const lvl = generateLevel({ colors: 4, bottles: 6, capacity: 4, seed }); // small — exact feasible
      expect(optimalCappedMoves(lvl.state, emptyGrid(lvl.state))).toBe(bfsOptimal(lvl.state));
    }
  });

  it('never exceeds the capped DFS-replay upper bound when it finds an exact answer', () => {
    for (const seed of [1, 2, 3]) {
      const lvl = generateLevel({ colors: 4, bottles: 6, capacity: 4, seed }); // small — exact is found
      const hidden = computeHidden(lvl.state, seed, exposableCells(lvl.state, lvl.solution));
      const exact = optimalCappedMoves(lvl.state, hidden);
      const upper = cappedSolveMoves(lvl.state, lvl.solution, hidden);
      expect(exact).not.toBeNull();
      expect(exact!).toBeLessThanOrEqual(upper);
    }
  });

  it('respects the node budget instead of hanging on a big board', () => {
    const lvl = generateLevel({ colors: 12, bottles: 15, capacity: 4, seed: 1 }); // exact is infeasible
    expect(optimalCappedMoves(lvl.state, emptyGrid(lvl.state), 2000)).toBeNull();
  });
});

describe('nearOptimalCutoffs', () => {
  it('reports an optimal matching the A* and a strictly-larger 2★ ceiling', () => {
    for (const seed of [1, 2, 3]) {
      const lvl = generateLevel({ colors: 4, bottles: 6, capacity: 4, seed }); // small — exact feasible
      const cutoffs = nearOptimalCutoffs(lvl.state, emptyGrid(lvl.state));
      expect(cutoffs).not.toBeNull();
      expect(cutoffs!.optimal).toBe(optimalCappedMoves(lvl.state, emptyGrid(lvl.state)));
      expect(cutoffs!.twoStarMax).toBeGreaterThan(cutoffs!.optimal);
    }
  });

  it('returns null when the node budget is exhausted before the optimal is found', () => {
    const lvl = generateLevel({ colors: 12, bottles: 15, capacity: 4, seed: 1 }); // exact is infeasible
    expect(nearOptimalCutoffs(lvl.state, emptyGrid(lvl.state), 2000)).toBeNull();
  });
});

describe('isCapped', () => {
  it('caps a full single-color, fully-revealed tube', () => {
    expect(isCapped(tube(['ruby', 'ruby', 'ruby', 'ruby']), 4)).toBe(true);
    expect(isCapped(tube(['ruby', 'ruby', 'ruby', 'ruby']), 4, [false, false, false, false])).toBe(
      true,
    );
  });

  it('does not cap a full single-color tube that still hides a cell', () => {
    expect(isCapped(tube(['ruby', 'ruby', 'ruby', 'ruby']), 4, [false, true, false, false])).toBe(
      false,
    );
  });

  it('does not cap partial, mixed, or empty tubes', () => {
    expect(isCapped(tube(['ruby', 'ruby']), 4)).toBe(false); // not full
    expect(isCapped(tube(['ruby', 'amber', 'ruby', 'ruby']), 4)).toBe(false); // mixed
    expect(isCapped(tube([]), 4)).toBe(false); // empty
  });
});

describe('emptyGrid', () => {
  it('matches the board shape and conceals nothing', () => {
    const grid = emptyGrid(board([['ruby', 'amber'], []]));
    expect(grid).toEqual([[false, false], []]);
  });
});
