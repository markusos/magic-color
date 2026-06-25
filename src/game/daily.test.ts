import { describe, it, expect } from 'vitest';
import { dailyKey, dailySeed, dailyShareText, dailyStreak, todayKey, type DailyRecord } from './daily';

describe('dailyKey', () => {
  it('formats a Date as its UTC YYYY-MM-DD', () => {
    expect(dailyKey(new Date('2026-06-24T13:45:00Z'))).toBe('2026-06-24');
  });

  it('uses UTC, not local time (a late-UTC instant stays on its UTC day)', () => {
    // 23:30 UTC is the same UTC day regardless of the runner's local zone.
    expect(dailyKey(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-01');
  });

  it('todayKey is a well-formed key', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dailySeed', () => {
  it('is deterministic: same key → same seed', () => {
    expect(dailySeed('2026-06-24')).toBe(dailySeed('2026-06-24'));
  });

  it('decorrelates adjacent dates', () => {
    expect(dailySeed('2026-06-24')).not.toBe(dailySeed('2026-06-25'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const s = dailySeed('2026-06-24');
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});

describe('dailyStreak', () => {
  const rec = (): DailyRecord => ({ stars: 3, moves: 10 });

  it('is 0 with no results', () => {
    expect(dailyStreak({}, '2026-06-24')).toBe(0);
  });

  it('counts consecutive solved days ending today', () => {
    const results = { '2026-06-22': rec(), '2026-06-23': rec(), '2026-06-24': rec() };
    expect(dailyStreak(results, '2026-06-24')).toBe(3);
  });

  it('stops at the first gap', () => {
    const results = { '2026-06-21': rec(), '2026-06-23': rec(), '2026-06-24': rec() };
    expect(dailyStreak(results, '2026-06-24')).toBe(2);
  });

  it('runs through yesterday when today is unsolved (an unfinished today is not a broken streak)', () => {
    const results = { '2026-06-22': rec(), '2026-06-23': rec() };
    expect(dailyStreak(results, '2026-06-24')).toBe(2);
  });

  it('is 0 when neither today nor yesterday is solved', () => {
    const results = { '2026-06-20': rec() };
    expect(dailyStreak(results, '2026-06-24')).toBe(0);
  });

  it('crosses month boundaries correctly', () => {
    const results = { '2026-05-31': rec(), '2026-06-01': rec() };
    expect(dailyStreak(results, '2026-06-01')).toBe(2);
  });
});

describe('dailyShareText', () => {
  it('formats the result line with star emoji and move count, then the game URL', () => {
    expect(dailyShareText('2026-06-24', { stars: 2, moves: 14 })).toBe(
      'Magic Color · 2026-06-24 · ⭐⭐ · 14 moves\nhttps://magic-color.ostberg.dev/',
    );
  });

  it('singularizes a one-move solve', () => {
    expect(dailyShareText('2026-06-24', { stars: 3, moves: 1 })).toBe(
      'Magic Color · 2026-06-24 · ⭐⭐⭐ · 1 move\nhttps://magic-color.ostberg.dev/',
    );
  });
});
