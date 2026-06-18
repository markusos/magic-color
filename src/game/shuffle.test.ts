import { describe, it, expect } from 'vitest';
import { shuffleBottles } from './shuffle';
import { mulberry32 } from './rng';
import { generateLevel } from './generator';
import { isSolvable } from './solver';
import { board } from '../test/board';

describe('shuffleBottles', () => {
  it('reorders tubes and the hidden grid by the same permutation', () => {
    const state = board([['ruby', 'ruby'], ['amber', 'teal'], []], 2);
    const hidden = [
      [true, false],
      [false, true],
      [],
    ];
    // A pinned PRNG gives a deterministic permutation we can assert against.
    const rng = mulberry32(7);
    const out = shuffleBottles(state, hidden, rng);

    // The multiset of (tube, hidden-row) pairs is preserved — rows still match their tube.
    const pairs = out.state.bottles.map((b, i) => JSON.stringify([b, out.hidden[i]]));
    const original = state.bottles.map((b, i) => JSON.stringify([b, hidden[i]]));
    expect(pairs.slice().sort()).toEqual(original.slice().sort());
    expect(out.state.capacity).toBe(2);
  });

  it('leaves solvability intact (it is a pure presentation transform)', () => {
    for (let seed = 0; seed < 25; seed++) {
      const level = generateLevel({ colors: 5, bottles: 7, seed });
      const empty = level.state.bottles.map((b) => b.map(() => false));
      const out = shuffleBottles(level.state, empty, mulberry32(seed * 31 + 1));
      expect(isSolvable(out.state)).toBe(true);
    }
  });

  it('actually permutes (not always the identity) across rolls', () => {
    const state = board([['ruby'], ['amber'], ['teal'], ['emerald'], ['rose']], 1);
    const empty = state.bottles.map(() => []);
    const orders = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const out = shuffleBottles(state, empty, mulberry32(seed));
      orders.add(out.state.bottles.map((b) => b[0]).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
