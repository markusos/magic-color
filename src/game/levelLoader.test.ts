import { describe, it, expect, afterEach } from 'vitest';
import { generateDailyLevel, generateRandomLevel, getLevel, resetLiveGenerator } from './levelLoader';

/** A board's identity for comparison — the tube contents (palette is recolored later, in the store). */
const fingerprint = (level: ReturnType<typeof generateDailyLevel>) => JSON.stringify(level.state.bottles);

describe('generateDailyLevel', () => {
  // The live cache memoizes by key; clear it so each spec exercises a real generation.
  afterEach(() => resetLiveGenerator());

  it('is deterministic: the same date yields the same board', () => {
    const a = generateDailyLevel('2026-06-24');
    resetLiveGenerator();
    const b = generateDailyLevel('2026-06-24');
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('different dates yield different boards', () => {
    const a = generateDailyLevel('2026-06-24');
    const b = generateDailyLevel('2026-06-25');
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('carries the full mechanic set (a daily showcases every mechanic)', () => {
    const level = generateDailyLevel('2026-06-24');
    expect([...level.mechanics].sort()).toEqual(['funnel', 'hidden', 'ice']);
  });

  it('memoizes within a key (the second call returns the cached board)', () => {
    const a = generateDailyLevel('2026-07-01');
    const b = generateDailyLevel('2026-07-01');
    expect(a).toBe(b);
  });
});

describe('live provenance', () => {
  afterEach(() => resetLiveGenerator());

  it('attaches the chosen board metrics to a random board', () => {
    const lp = generateRandomLevel(12345).liveProvenance;
    expect(lp).toBeDefined();
    expect(typeof lp!.score).toBe('number');
    expect(typeof lp!.targetPercentile).toBe('number');
    expect(typeof lp!.family).toBe('string');
    // Live boards use the proxy optimal, never the exact A*.
    expect(lp!.metrics.optimalExact).toBe(false);
    expect(lp!.metrics.colors).toBeGreaterThan(0);
  });

  it('attaches metrics to the daily board too', () => {
    expect(generateDailyLevel('2026-06-24').liveProvenance).toBeDefined();
  });

  it('leaves it undefined for a baked level (its provenance is committed separately)', () => {
    expect(getLevel(1).liveProvenance).toBeUndefined();
  });
});
