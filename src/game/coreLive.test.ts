/**
 * Live-generation differential, JS vs WASM (Track F3): with the real committed `.wasm`
 * loaded, the core-side `pickBest` must produce the IDENTICAL board, overlays, star data, and
 * provenance as the JS path — for the daily challenge (cross-device determinism is the whole
 * point) and the endless random mode. Runs under the test live-config the suite installs
 * (small pools), which exercises the identical selection logic at test-friendly breadth.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initCoreWasmSync } from './coreWasm';
import {
  generateDailyLevel,
  generateRandomLevel,
  resetLiveGenerator,
  setLiveCoreEnabled,
  type LoadedLevel,
} from './levelLoader';

const wasmPath = join(dirname(fileURLToPath(import.meta.url)), 'core-pkg/magic_color_core_bg.wasm');

beforeAll(() => {
  initCoreWasmSync(readFileSync(wasmPath));
});

afterEach(() => {
  setLiveCoreEnabled(false);
  resetLiveGenerator();
});

/** The fields that must agree exactly (drop functions/undefined noise via JSON round-trip). */
function comparable(level: LoadedLevel): unknown {
  const { state, solution, hidden, funnels, ice, optimal, twoStarMax, par, minMoves, seed, liveProvenance } = level;
  return JSON.parse(
    JSON.stringify({ state, solution, hidden, funnels, ice, optimal, twoStarMax, par, minMoves, seed, liveProvenance }),
  );
}

describe('live generation differential (JS vs WASM core)', () => {
  it('daily challenge boards are identical on both cores', () => {
    for (const key of ['2026-07-04', '2026-01-15', '2025-11-30']) {
      setLiveCoreEnabled(false);
      resetLiveGenerator();
      const js = generateDailyLevel(key);

      setLiveCoreEnabled(true); // also clears the caches
      const wasm = generateDailyLevel(key);

      expect(comparable(wasm)).toEqual(comparable(js));
    }
  });

  it('random-mode boards are identical on both cores', () => {
    for (const seed of [7, 123456, 987654321]) {
      setLiveCoreEnabled(false);
      resetLiveGenerator();
      const js = generateRandomLevel(seed);

      setLiveCoreEnabled(true);
      const wasm = generateRandomLevel(seed);

      expect(comparable(wasm)).toEqual(comparable(js));
    }
  });
});
