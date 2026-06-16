import { describe, it, expect } from 'vitest';
import { starsFor } from './stars';

describe('starsFor', () => {
  it('awards 3 stars for a close-to-perfect solve (at/near optimal)', () => {
    expect(starsFor(0, 20)).toBe(3); // an unfinished projection starts at 3
    expect(starsFor(20, 20)).toBe(3); // exactly optimal
    expect(starsFor(22, 20)).toBe(3); // within the 3-star cutoff (1.1x)
  });

  it('awards 2 stars around par and 1 star beyond it', () => {
    expect(starsFor(25, 20)).toBe(2); // above 3-star cutoff, within par (1.5x)
    expect(starsFor(30, 20)).toBe(2); // at par
    expect(starsFor(31, 20)).toBe(1); // beyond par
    expect(starsFor(60, 20)).toBe(1);
  });

  it('is monotonic: more moves never earns more stars', () => {
    let prev = 3;
    for (let moves = 0; moves <= 80; moves++) {
      const s = starsFor(moves, 20);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });
});
