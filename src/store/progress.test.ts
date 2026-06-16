import { describe, it, expect, beforeEach } from 'vitest';
import { clearProgress, loadProgress, recordResult, saveProgress, type Progress } from './progress';

const base = (over: Partial<Progress> = {}): Progress => ({
  version: 1,
  current: 1,
  best: {},
  stars: {},
  ...over,
});

describe('progress persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns fresh defaults when nothing is stored', () => {
    expect(loadProgress()).toEqual({ version: 1, current: 1, best: {}, stars: {} });
  });

  it('round-trips through localStorage', () => {
    saveProgress(base({ current: 7, best: { 3: 18 }, stars: { 3: 2 } }));
    expect(loadProgress()).toEqual({ version: 1, current: 7, best: { 3: 18 }, stars: { 3: 2 } });
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

  it('clears stored progress', () => {
    saveProgress(base({ current: 9 }));
    clearProgress();
    expect(loadProgress().current).toBe(1);
  });
});
