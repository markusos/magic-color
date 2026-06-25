import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearProgress,
  loadProgress,
  recordDaily,
  recordHint,
  recordRandomHardStreak,
  recordResult,
  saveProgress,
  type Progress,
} from './progress';

const base = (over: Partial<Progress> = {}): Progress => ({
  version: 1,
  current: 1,
  best: {},
  stars: {},
  randomHardBestStreak: 0,
  hintsUsed: 0,
  daily: {},
  ...over,
});

describe('progress persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns fresh defaults when nothing is stored', () => {
    expect(loadProgress()).toEqual({
      version: 1,
      current: 1,
      best: {},
      stars: {},
      randomHardBestStreak: 0,
      hintsUsed: 0,
      daily: {},
    });
  });

  it('round-trips through localStorage', () => {
    saveProgress(base({ current: 7, best: { 3: 18 }, stars: { 3: 2 }, randomHardBestStreak: 4, hintsUsed: 9 }));
    expect(loadProgress()).toEqual({
      version: 1,
      current: 7,
      best: { 3: 18 },
      stars: { 3: 2 },
      randomHardBestStreak: 4,
      hintsUsed: 9,
      daily: {},
    });
  });

  it('defaults the random-hard streak, hint count, and daily map for older saves that lack them', () => {
    localStorage.setItem('magic-color:v1', JSON.stringify({ version: 1, current: 5, best: {}, stars: {} }));
    expect(loadProgress().randomHardBestStreak).toBe(0);
    expect(loadProgress().hintsUsed).toBe(0);
    expect(loadProgress().daily).toEqual({});
  });

  it('round-trips and sanitizes the daily map (dropping malformed entries)', () => {
    saveProgress(base({ daily: { '2026-06-24': { stars: 2, moves: 14 } } }));
    expect(loadProgress().daily).toEqual({ '2026-06-24': { stars: 2, moves: 14 } });

    localStorage.setItem(
      'magic-color:v1',
      JSON.stringify({
        version: 1,
        current: 1,
        best: {},
        stars: {},
        daily: { good: { stars: 3, moves: 5 }, bad: { stars: 'x' }, alsoBad: 7 },
      }),
    );
    expect(loadProgress().daily).toEqual({ good: { stars: 3, moves: 5 } });
  });

  it('tallies hints immutably', () => {
    const start = base({ hintsUsed: 2 });
    expect(recordHint(start).hintsUsed).toBe(3);
    expect(start.hintsUsed).toBe(2); // input unchanged
  });

  it('keeps the longest random-hard streak only', () => {
    expect(recordRandomHardStreak(base({ randomHardBestStreak: 3 }), 5).randomHardBestStreak).toBe(5);
    expect(recordRandomHardStreak(base({ randomHardBestStreak: 6 }), 4).randomHardBestStreak).toBe(6);
  });

  it('falls back to defaults on a version mismatch or garbage', () => {
    localStorage.setItem('magic-color:v1', JSON.stringify({ version: 99, current: 5 }));
    expect(loadProgress().current).toBe(1);
    localStorage.setItem('magic-color:v1', 'not json');
    expect(loadProgress().current).toBe(1);
  });

  it('clamps a bogus current level to at least 1', () => {
    saveProgress(base({ current: -4 }));
    expect(loadProgress().current).toBe(1);
  });

  describe('recordResult', () => {
    it('keeps the fewest moves and the most stars', () => {
      const first = recordResult(base(), 2, 20, 2);
      expect(first.best[2]).toBe(20);
      expect(first.stars[2]).toBe(2);

      const worse = recordResult(first, 2, 25, 1); // more moves, fewer stars — unchanged
      expect(worse.best[2]).toBe(20);
      expect(worse.stars[2]).toBe(2);

      const better = recordResult(first, 2, 16, 3); // fewer moves, more stars — improved
      expect(better.best[2]).toBe(16);
      expect(better.stars[2]).toBe(3);
    });

    it('does not mutate the input', () => {
      const start = base();
      recordResult(start, 1, 5, 3);
      expect(start.best[1]).toBeUndefined();
      expect(start.stars[1]).toBeUndefined();
    });
  });

  describe('recordDaily', () => {
    const key = '2026-06-24';

    it('records the first result for a day', () => {
      const r = recordDaily(base(), key, 2, 14);
      expect(r.daily[key]).toEqual({ stars: 2, moves: 14 });
    });

    it('keeps a better result (more stars, or fewer moves at equal stars)', () => {
      const first = recordDaily(base(), key, 2, 14);
      expect(recordDaily(first, key, 3, 20).daily[key]).toEqual({ stars: 3, moves: 20 }); // more stars
      expect(recordDaily(first, key, 2, 10).daily[key]).toEqual({ stars: 2, moves: 10 }); // fewer moves
    });

    it('ignores a worse result', () => {
      const first = recordDaily(base(), key, 3, 12);
      expect(recordDaily(first, key, 1, 8).daily[key]).toEqual({ stars: 3, moves: 12 }); // fewer stars
      expect(recordDaily(first, key, 3, 20).daily[key]).toEqual({ stars: 3, moves: 12 }); // more moves
    });

    it('does not mutate the input', () => {
      const start = base();
      recordDaily(start, key, 3, 5);
      expect(start.daily[key]).toBeUndefined();
    });
  });

  it('clears stored progress', () => {
    saveProgress(base({ current: 9 }));
    clearProgress();
    expect(loadProgress().current).toBe(1);
  });
});
