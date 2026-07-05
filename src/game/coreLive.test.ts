/**
 * Live generation through the Rust core (Track F5 — the only live path; the JS twin and the
 * A/B flag are gone). The committed `.wasm` is loaded for real by the test setup, so these
 * exercise the shipping pipeline end-to-end: determinism per seed/date (the daily's
 * cross-device contract), memoization, and the shape of what reaches the store.
 */
import { describe, expect, it } from 'vitest';
import { isWon, pour } from './engine';
import {
  generateDailyLevel,
  generateRandomLevel,
  loadDiagnostics,
  resetLiveGenerator,
  type LoadedLevel,
} from './levelLoader';

/** Comparable projection (JSON round-trip drops functions/undefined noise). */
function comparable(level: LoadedLevel): unknown {
  const { state, solution, hidden, funnels, ice, optimal, twoStarMax, par, minMoves, seed, liveProvenance } = level;
  return JSON.parse(
    JSON.stringify({ state, solution, hidden, funnels, ice, optimal, twoStarMax, par, minMoves, seed, liveProvenance }),
  );
}

describe('live generation (Rust core)', () => {
  it('daily boards are deterministic per date key and memoized', () => {
    resetLiveGenerator();
    const a = generateDailyLevel('2026-07-04');
    expect(generateDailyLevel('2026-07-04')).toBe(a); // cache hit — same object

    resetLiveGenerator();
    const b = generateDailyLevel('2026-07-04');
    expect(comparable(b)).toEqual(comparable(a)); // regenerated — identical board

    const other = generateDailyLevel('2026-01-15');
    expect(comparable(other)).not.toEqual(comparable(a)); // different date, different board
  });

  it('random-mode boards are deterministic per seed and solvable via their stored solution', () => {
    for (const seed of [7, 123456]) {
      const a = generateRandomLevel(seed);
      const b = generateRandomLevel(seed);
      expect(comparable(b)).toEqual(comparable(a));

      let cur = a.state;
      for (const m of a.solution) cur = pour(cur, m.from, m.to).state;
      expect(isWon(cur)).toBe(true);
      expect(a.twoStarMax).toBeGreaterThan(a.optimal);
      expect(a.liveProvenance?.metrics.colors).toBe(a.colors);
    }
  });

  it('records load diagnostics for the E9 readout', () => {
    resetLiveGenerator();
    generateDailyLevel('2026-03-03');
    const d = loadDiagnostics();
    expect(d.last?.label).toBe('daily 2026-03-03');
    expect(d.last?.source).toBe('live');
    expect(d.dailyCacheSize).toBe(1);
  });
});
