import { describe, it, expect } from 'vitest';
import {
  anyFunnel,
  computeFunnels,
  funnelAccepts,
  funnelEligibleTubes,
  funnelLegalMoves,
  funnelLoad,
  noFunnels,
  recolorFunnels,
  type FunnelGrid,
} from './funnels';
import { pour } from './engine';
import { emptyGrid } from './hidden';
import { optimalCappedMoves } from './search';
import { isSolvable, solve } from './solver';
import { generateLevel } from './generator';
import { board, color } from '../test/board';
import type { Color, Move } from './types';

const C = (id: string): Color => color(id);

describe('funnelAccepts', () => {
  it('an ordinary (null) tube accepts any color; a funnel only its tint', () => {
    const funnels: FunnelGrid = [null, C('ruby')];
    expect(funnelAccepts(funnels, 0, C('teal'))).toBe(true); // null tube
    expect(funnelAccepts(funnels, 1, C('ruby'))).toBe(true); // matching tint
    expect(funnelAccepts(funnels, 1, C('teal'))).toBe(false); // mismatched tint
  });

  it('treats an undefined grid as no funnels (accepts everything)', () => {
    expect(funnelAccepts(undefined, 3, C('amber'))).toBe(true);
  });
});

describe('funnelEligibleTubes', () => {
  it('marks a tube eligible only when every solution pour into it is the same color', () => {
    const state = board([[], [], [], []], 4);
    const solution: Move[] = [
      { from: 0, to: 2, count: 1, color: C('ruby') }, // tube 2: only ruby → eligible(ruby)
      { from: 1, to: 3, count: 1, color: C('teal') }, // tube 3: teal …
      { from: 0, to: 3, count: 1, color: C('ruby') }, // … then ruby → mixed, not eligible
    ];
    const elig = funnelEligibleTubes(state, solution);
    expect(elig[2]).toBe(C('ruby'));
    expect(elig[3]).toBeNull(); // mixed inflow
    expect(elig[0]).toBeNull(); // no inflow at all
    expect(elig[1]).toBeNull();
  });
});

describe('computeFunnels', () => {
  it('only ever locks an eligible tube, and only to its inflow color', () => {
    const state = board([[], [], [], [], []], 4);
    const eligible = [C('ruby'), null, C('teal'), null, C('amber')];
    for (let seed = 0; seed < 50; seed++) {
      const funnels = computeFunnels(state, seed, eligible);
      funnels.forEach((tint, t) => {
        if (tint != null) expect(tint).toBe(eligible[t]); // never the wrong color, never an ineligible tube
      });
    }
  });

  it('is deterministic for a given seed', () => {
    const state = board([[], [], []], 4);
    const eligible = [C('ruby'), C('teal'), null];
    expect(computeFunnels(state, 12345, eligible)).toEqual(computeFunnels(state, 12345, eligible));
  });

  it('always locks at least one tube when any tube is eligible', () => {
    const state = board([[], [], []], 4);
    const eligible = [C('ruby'), C('teal'), null];
    for (let seed = 0; seed < 200; seed++) {
      expect(anyFunnel(computeFunnels(state, seed, eligible))).toBe(true);
    }
  });

  it('locks nothing when no tube is eligible', () => {
    const state = board([[], []], 4);
    const eligible = [null, null];
    expect(anyFunnel(computeFunnels(state, 7, eligible))).toBe(false);
  });
});

describe('funnelLegalMoves', () => {
  it('drops pours a destination funnel rejects, keeps the rest', () => {
    // Tube 0 = ruby on top, tube 1 = empty locked to teal, tube 2 = empty (null).
    const state = board([['ruby'], [], []], 4);
    const funnels: FunnelGrid = [null, C('teal'), null];
    const moves = funnelLegalMoves(state, funnels);
    // Pour ruby → tube 1 is illegal (teal funnel); ruby → tube 2 is fine.
    expect(moves.some((m) => m.from === 0 && m.to === 1)).toBe(false);
    expect(moves.some((m) => m.from === 0 && m.to === 2)).toBe(true);
  });

  it('with no funnels equals the plain legal moves', () => {
    const state = board([['ruby'], ['teal'], []], 4);
    expect(funnelLegalMoves(state)).toEqual(funnelLegalMoves(state, noFunnels(state)));
  });
});

describe('recolorFunnels', () => {
  it('remaps every tint through the bijection, leaving nulls alone', () => {
    const funnels: FunnelGrid = [C('ruby'), null, C('teal')];
    const map = { ruby: C('jade'), teal: C('rose') } as Record<string, Color>;
    expect(recolorFunnels(funnels, map)).toEqual([C('jade'), null, C('rose')]);
  });
});

describe('funnelLoad', () => {
  it('is the locked-tube count over colors, clamped to 1', () => {
    expect(funnelLoad([null, null, null], 3)).toBe(0);
    expect(funnelLoad([C('ruby'), null, C('teal')], 4)).toBeCloseTo(0.5);
    expect(funnelLoad([C('a'), C('b'), C('c')], 2)).toBe(1); // clamped
  });
});

describe('anyFunnel', () => {
  it('detects whether any tube is locked', () => {
    expect(anyFunnel([null, null])).toBe(false);
    expect(anyFunnel([null, C('ruby')])).toBe(true);
  });
});

describe('solvability is preserved by construction', () => {
  // The load-bearing guarantee: funnels are derived from the stored solution (only tubes whose inflow
  // is monochrome, locked to that color), so the stored solution stays legal under the funnel rule and
  // the board remains solvable. Mirrors capping.test.ts.
  it('the stored solution stays funnel-legal, and the board stays funnel-solvable, across many boards', () => {
    let checked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const level = generateLevel({ colors: 4, bottles: 6, seed });
      const solution = level.solution;
      const eligible = funnelEligibleTubes(level.state, solution);
      const funnels = computeFunnels(level.state, seed, eligible);
      if (!anyFunnel(funnels)) continue; // only boards that actually got a funnel exercise the rule
      checked++;

      // Replaying the stored solution never hits a funnel it violates.
      let cur = level.state;
      for (const m of solution) {
        expect(funnelAccepts(funnels, m.to, m.color)).toBe(true);
        cur = pour(cur, m.from, m.to).state;
      }

      // And the funnel-aware solver still finds *a* solution.
      expect(isSolvable(level.state, { funnels })).toBe(true);
    }
    expect(checked).toBeGreaterThan(0); // the test actually exercised funneled boards
  });
});

describe('funnels never make a board easier', () => {
  // Removing legal moves can only lengthen (or hold) the optimal — never shorten it.
  it('the funnel-aware optimal is >= the un-funneled optimal', () => {
    for (let seed = 0; seed < 40; seed++) {
      const level = generateLevel({ colors: 4, bottles: 6, seed });
      const eligible = funnelEligibleTubes(level.state, solve(level.state)!);
      const funnels = computeFunnels(level.state, seed, eligible);
      if (!anyFunnel(funnels)) continue;
      const base = optimalCappedMoves(level.state, emptyGrid(level.state));
      const withFunnels = optimalCappedMoves(level.state, emptyGrid(level.state), undefined, funnels);
      if (base == null || withFunnels == null) continue; // budget overflow — skip
      expect(withFunnels).toBeGreaterThanOrEqual(base);
    }
  });
});
