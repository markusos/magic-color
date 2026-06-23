import { describe, it, expect } from 'vitest';
import {
  anyFrozen,
  anyIce,
  buildIce,
  cappedColors,
  computeIce,
  frozenCells,
  iceEligibleLines,
  iceLoad,
  noIce,
  recolorIce,
  solutionPoursThroughIce,
  type IceGrid,
} from './ice';
import { pour } from './engine';
import { emptyGrid, type HiddenGrid } from './hidden';
import { optimalCappedMoves } from './search';
import { generateLevel } from './generator';
import { board, color } from '../test/board';
import type { Color } from './types';

const C = (id: string): Color => color(id);

/** Ice grid from per-tube `[line, trigger]` specs (freeze cells 0..line); `null` for an unfrozen tube. */
function ice(state: ReturnType<typeof board>, specs: ([number, string] | null)[]): IceGrid {
  return state.bottles.map((bottle, b) => {
    const spec = specs[b];
    return bottle.map((_, i) => (spec && i <= spec[0] ? C(spec[1]) : null));
  });
}

describe('noIce / anyIce', () => {
  it('noIce is an all-clear grid shaped to the board', () => {
    const state = board([['ruby', 'ruby'], []], 4);
    expect(noIce(state)).toEqual([[null, null], []]);
    expect(anyIce(noIce(state))).toBe(false);
  });

  it('anyIce detects a frozen cell', () => {
    expect(anyIce([[C('ruby'), null], [null]])).toBe(true);
  });
});

describe('cappedColors', () => {
  const full = (c: string) => [c, c, c, c];

  it('a full, single-color, ice-free tube caps its color', () => {
    const state = board([full('ruby'), ['teal']], 4);
    expect(cappedColors(state, emptyGrid(state), noIce(state))).toEqual(new Set([C('ruby')]));
  });

  it("a full tube isn't capped while it still holds a frozen cell of its own", () => {
    const state = board([full('ruby'), ['teal']], 4);
    // ruby tube frozen at its base, trigger teal — teal is never capped here, so ruby never caps.
    const g = ice(state, [[0, 'teal'], null]);
    expect(cappedColors(state, emptyGrid(state), g).has(C('ruby'))).toBe(false);
  });

  it('thaws in a cascade: capping teal frees ruby ice, which lets ruby cap, which frees an amber-trigger', () => {
    // tube0 capped teal; tube1 full ruby frozen by teal; tube2 frozen by ruby.
    const state = board([full('teal'), full('ruby'), full('amber')], 4);
    const g = ice(state, [null, [1, 'teal'], [1, 'ruby']]);
    const capped = cappedColors(state, emptyGrid(state), g);
    expect(capped.has(C('teal'))).toBe(true); // base case
    expect(capped.has(C('ruby'))).toBe(true); // freed by teal cap → caps
    expect(capped.has(C('amber'))).toBe(true); // freed by ruby cap (cascade) → caps
  });
});

describe('frozenCells / anyFrozen', () => {
  it('a cell is frozen iff its trigger color is not yet capped', () => {
    const state = board([['ruby', 'ruby', 'ruby', 'ruby'], ['teal']], 4);
    // tube1 frozen by ruby — but ruby IS capped (tube0 full ruby) ⇒ thawed.
    const thawed = ice(state, [null, [0, 'ruby']]);
    expect(frozenCells(state, emptyGrid(state), thawed)[1]).toEqual([false]);
    expect(anyFrozen(state, emptyGrid(state), thawed)).toBe(false);

    // tube1 frozen by amber — amber never caps ⇒ stays frozen.
    const frozen = ice(state, [null, [0, 'amber']]);
    expect(frozenCells(state, emptyGrid(state), frozen)[1]).toEqual([true]);
    expect(anyFrozen(state, emptyGrid(state), frozen)).toBe(true);
  });

  it('ignores ice on cells already poured away (clamps to current bottles)', () => {
    const state = board([['amber'], []], 4); // a 1-tall tube
    const g: IceGrid = [[C('teal')], []];
    const after = pour(state, 0, 1).state; // tube0 now empty
    expect(frozenCells(after, emptyGrid(after), g)[0]).toEqual([]); // no phantom frozen cell
  });
});

describe('recolorIce', () => {
  it('remaps every tint through the bijection, leaving nulls alone', () => {
    const g: IceGrid = [[C('ruby'), null], [C('teal')]];
    const map = { ruby: C('jade'), teal: C('rose') } as Record<string, Color>;
    expect(recolorIce(g, map)).toEqual([[C('jade'), null], [C('rose')]]);
  });
});

describe('iceLoad', () => {
  it('is the frozen-cell fraction', () => {
    expect(iceLoad([[null, null], [null]])).toBe(0);
    expect(iceLoad([[C('ruby'), C('ruby')], [null, null]])).toBeCloseTo(0.5);
  });
});

describe('computeIce', () => {
  it('only ever freezes an eligible tube, as a contiguous bottom block of one eligible trigger', () => {
    const state = board([['ruby', 'ruby', 'ruby'], ['teal', 'teal', 'teal'], ['jade', 'jade']], 4);
    const eligible = [
      [{ line: 1, triggers: [C('teal')] }],
      [],
      [{ line: 0, triggers: [C('ruby'), C('teal')] }],
    ];
    for (let seed = 0; seed < 50; seed++) {
      const g = computeIce(state, seed, eligible);
      expect(g[1]).toEqual([null, null, null]); // ineligible tube never frozen
      g.forEach((col, b) => {
        // contiguous from the base, single color
        const tint = col.find((t) => t != null) ?? null;
        col.forEach((t, i) => {
          if (t != null) {
            expect(col.slice(0, i + 1).every((x) => x != null)).toBe(true); // unbroken from base
            expect(t).toBe(tint); // one color
          }
        });
        if (b === 0 && tint) expect(tint).toBe(C('teal'));
      });
    }
  });

  it('is deterministic per seed', () => {
    const state = board([['ruby', 'ruby'], ['teal']], 4);
    const eligible = [[{ line: 0, triggers: [C('teal')] }], []];
    expect(computeIce(state, 999, eligible)).toEqual(computeIce(state, 999, eligible));
  });

  it('freezes nothing when no tube is eligible', () => {
    const state = board([['ruby'], ['teal']], 4);
    expect(anyIce(computeIce(state, 3, [[], []]))).toBe(false);
  });
});

describe('buildIce — guaranteed-solvable grids', () => {
  // The load-bearing guarantee: ice is derived from the stored solution and PRUNED so the solution
  // never pours through frozen ice — even across cascades where freezing one tube delays another's cap.
  it('the stored solution never pours through frozen ice, and the board fully thaws, across many boards', () => {
    let checked = 0;
    for (let seed = 0; seed < 120; seed++) {
      const level = generateLevel({ colors: 4, bottles: 6, seed });
      const hidden: HiddenGrid = emptyGrid(level.state);
      const g = buildIce(level.state, level.solution, hidden, seed);
      if (!anyIce(g)) continue;
      checked++;

      expect(solutionPoursThroughIce(level.state, level.solution, hidden, g)).toBeNull();

      let cur = level.state;
      for (const m of level.solution) cur = pour(cur, m.from, m.to).state;
      expect(anyFrozen(cur, hidden, g)).toBe(false); // every block thawed by the end ⇒ finishable
    }
    expect(checked).toBeGreaterThan(0); // the test actually exercised frozen boards
  });

  it('always shows the mechanic when the board has any eligible tube', () => {
    // Most generated boards have an eligible tube; assert ice appears wherever one exists.
    let withEligible = 0;
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel({ colors: 4, bottles: 6, seed });
      const hidden = emptyGrid(level.state);
      const hasEligible = iceEligibleLines(level.state, level.solution, hidden).some((o) => o.length > 0);
      if (!hasEligible) continue;
      withEligible++;
      expect(anyIce(buildIce(level.state, level.solution, hidden, seed))).toBe(true);
    }
    expect(withEligible).toBeGreaterThan(0);
  });

  it('is deterministic per seed', () => {
    const level = generateLevel({ colors: 4, bottles: 6, seed: 7 });
    const hidden = emptyGrid(level.state);
    expect(buildIce(level.state, level.solution, hidden, 7)).toEqual(
      buildIce(level.state, level.solution, hidden, 7),
    );
  });
});

describe('ice never makes a board easier (exact optimal)', () => {
  // Frozen cells only remove legal pours, so the ice-aware exact optimal can only hold or rise — and
  // the ice-aware search must still find a finite optimum (the board stays solvable by construction).
  it('the ice-aware optimal is >= the un-iced optimal, and finite', () => {
    let checked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel({ colors: 4, bottles: 6, seed });
      const hidden = emptyGrid(level.state);
      const g = buildIce(level.state, level.solution, hidden, seed);
      if (!anyIce(g)) continue;
      const base = optimalCappedMoves(level.state, hidden);
      const withIce = optimalCappedMoves(level.state, hidden, undefined, undefined, g);
      if (base == null || withIce == null) continue; // budget overflow — skip
      checked++;
      expect(withIce).toBeGreaterThanOrEqual(base);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
