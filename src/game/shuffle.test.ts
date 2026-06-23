import { describe, it, expect } from 'vitest';
import { shuffleBottles } from './shuffle';
import { noFunnels } from './funnels';
import { noIce } from './ice';
import { mulberry32 } from './rng';
import { generateLevel } from './generator';
import { isSolvable } from './solver';
import { board } from '../test/board';
import type { Color } from './types';

describe('shuffleBottles', () => {
  it('reorders tubes, the hidden grid, the funnels, and the ice by the same permutation', () => {
    const state = board([['ruby', 'ruby'], ['amber', 'teal'], []], 2);
    const hidden = [
      [true, false],
      [false, true],
      [],
    ];
    const funnels = ['ruby' as Color, null, 'teal' as Color];
    const ice = [['ruby' as Color, null], [null, null], []];
    // A pinned PRNG gives a deterministic permutation we can assert against.
    const rng = mulberry32(7);
    const out = shuffleBottles(state, hidden, funnels, ice, rng);

    // The multiset of (tube, hidden-row, funnel, ice-row) tuples is preserved — overlays still match tubes.
    const tuples = out.state.bottles.map((b, i) =>
      JSON.stringify([b, out.hidden[i], out.funnels[i], out.ice[i]]),
    );
    const original = state.bottles.map((b, i) => JSON.stringify([b, hidden[i], funnels[i], ice[i]]));
    expect(tuples.slice().sort()).toEqual(original.slice().sort());
    expect(out.state.capacity).toBe(2);
  });

  it('leaves solvability intact (it is a pure presentation transform)', () => {
    for (let seed = 0; seed < 25; seed++) {
      const level = generateLevel({ colors: 5, bottles: 7, seed });
      const empty = level.state.bottles.map((b) => b.map(() => false));
      const out = shuffleBottles(
        level.state,
        empty,
        noFunnels(level.state),
        noIce(level.state),
        mulberry32(seed * 31 + 1),
      );
      expect(isSolvable(out.state)).toBe(true);
    }
  });

  it('actually permutes (not always the identity) across rolls', () => {
    const state = board([['ruby'], ['amber'], ['teal'], ['emerald'], ['rose']], 1);
    const empty = state.bottles.map(() => []);
    const orders = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const out = shuffleBottles(state, empty, noFunnels(state), noIce(state), mulberry32(seed));
      orders.add(out.state.bottles.map((b) => b[0]).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
