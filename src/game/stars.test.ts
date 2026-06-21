import { describe, it, expect } from 'vitest';
import { starsFor } from './stars';

// optimal = 20 (3★ cutoff), twoStarMax = 23 (2★ ceiling).
describe('starsFor', () => {
  it('awards 3 stars only for an exactly-optimal solve', () => {
    expect(starsFor(0, 20, 23)).toBe(3); // in-progress projection starts at 3
    expect(starsFor(20, 20, 23)).toBe(3); // exactly optimal
    expect(starsFor(21, 20, 23)).toBe(2); // one move over optimal is no longer perfect
  });

  it('awards 2 stars across the adjusted band and 1 star beyond it', () => {
    expect(starsFor(22, 20, 23)).toBe(2); // inside the band
    expect(starsFor(23, 20, 23)).toBe(2); // at the 2★ ceiling
    expect(starsFor(24, 20, 23)).toBe(1); // beyond the band
    expect(starsFor(100, 20, 23)).toBe(1);
  });

  it('honors a board-specific (wider) 2★ band', () => {
    // A tightly-forced board whose only near-optimal lines are several moves up.
    expect(starsFor(20, 20, 26)).toBe(3);
    expect(starsFor(26, 20, 26)).toBe(2);
    expect(starsFor(27, 20, 26)).toBe(1);
  });

  it('is monotonic: more moves never earns more stars', () => {
    let prev = 3;
    for (let moves = 0; moves <= 90; moves++) {
      const s = starsFor(moves, 20, 23);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });
});
