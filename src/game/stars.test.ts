import { describe, it, expect } from 'vitest';
import { starsFor } from './stars';

// With optimal = 20: 3-star cutoff = round(20*1.5) = 30; par (2-star) = round(20*2) = 40.
describe('starsFor', () => {
  it('awards 3 stars for a close-to-perfect solve', () => {
    expect(starsFor(0, 20)).toBe(3); // unfinished projection starts at 3
    expect(starsFor(20, 20)).toBe(3); // exactly optimal
    expect(starsFor(30, 20)).toBe(3); // at the 3-star cutoff
  });

  it('awards 2 stars around par and 1 star beyond it', () => {
    expect(starsFor(31, 20)).toBe(2); // just past the 3-star cutoff
    expect(starsFor(40, 20)).toBe(2); // at par
    expect(starsFor(41, 20)).toBe(1); // beyond par
    expect(starsFor(100, 20)).toBe(1);
  });

  it('is monotonic: more moves never earns more stars', () => {
    let prev = 3;
    for (let moves = 0; moves <= 90; moves++) {
      const s = starsFor(moves, 20);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });
});
