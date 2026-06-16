import { describe, it, expect, beforeEach } from 'vitest';
import { clearProgress, loadProgress, recordBest, saveProgress } from './progress';

describe('progress persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns fresh defaults when nothing is stored', () => {
    expect(loadProgress()).toEqual({ version: 1, current: 1, best: {} });
  });

  it('round-trips through localStorage', () => {
    saveProgress({ version: 1, current: 7, best: { 3: 18 } });
    expect(loadProgress()).toEqual({ version: 1, current: 7, best: { 3: 18 } });
  });

  it('falls back to defaults on a version mismatch or garbage', () => {
    localStorage.setItem('magic-color:v1', JSON.stringify({ version: 99, current: 5 }));
    expect(loadProgress().current).toBe(1);
    localStorage.setItem('magic-color:v1', 'not json');
    expect(loadProgress().current).toBe(1);
  });

  it('clamps a bogus current level to at least 1', () => {
    saveProgress({ version: 1, current: -4, best: {} });
    expect(loadProgress().current).toBe(1);
  });

  describe('recordBest', () => {
    it('stores a first score and improves only on a lower one', () => {
      const base = { version: 1, current: 1, best: {} as Record<number, number> };
      const first = recordBest(base, 2, 20);
      expect(first.best[2]).toBe(20);
      expect(recordBest(first, 2, 25).best[2]).toBe(20); // worse — unchanged
      expect(recordBest(first, 2, 16).best[2]).toBe(16); // better — improved
    });

    it('does not mutate the input', () => {
      const base = { version: 1, current: 1, best: {} as Record<number, number> };
      recordBest(base, 1, 5);
      expect(base.best[1]).toBeUndefined();
    });
  });

  it('clears stored progress', () => {
    saveProgress({ version: 1, current: 9, best: {} });
    clearProgress();
    expect(loadProgress().current).toBe(1);
  });
});
