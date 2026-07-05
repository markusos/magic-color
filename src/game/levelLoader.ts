/**
 * Runtime level LOADING. Turns a level number into a `PlayableLevel` the app can render: a committed
 * pre-baked board when one exists (`levels.data.ts`), otherwise a board generated LIVE from the
 * campaign's shape menu (the endless plateau tail and any un-baked fallback).
 *
 * This module is deliberately separate from `progression.ts` (the bake-relevant pure config it imports
 * from). Nothing here feeds the offline bake's board output, so the staleness guard
 * (`scripts/levelVersion.ts`) does NOT hash this file — tuning the live-generation budget or the load
 * path here will not force a re-bake. Keep bake-affecting logic in `progression.ts`.
 *
 * Persistence stores only the level number; baked boards load from data, live ones regenerate.
 */
import type { BakedLevel } from './baked';
import { coreWasmReady, initCoreWasm, wasmPickBest } from './coreWasm';
import { deserializeOverlays } from './mechanics';
import { dailySeed } from './daily';
import {
  balancedDensity,
  CAMPAIGN_LENGTH,
  CHAPTER_LEN,
  chapterForLevel,
  type LevelPlan,
  mechanicsForLevel,
  planForLevel,
  type PlayableLevel,
  seedForLevel,
  SHAPES,
  targetPercentile,
} from './progression';
import type { LiveProvenance } from './provenance';
import { type Difficulty, type GameState, toColors } from './types';

/**
 * A loaded board. For LIVE boards (random/endless, daily, un-baked tail) it carries the difficulty
 * metrics the generator measured while choosing it (`liveProvenance`); baked boards leave it undefined
 * (their committed provenance is looked up separately, on demand). The store mirrors this onto a reactive
 * field for the inspector. Defined here (not in the bake-hashed `progression.ts`) so this stays re-bake-free.
 */
export type LoadedLevel = PlayableLevel & { liveProvenance?: LiveProvenance };

/**
 * The pre-baked boards, loaded LAZILY via dynamic import so the ~200 kB data blob lands in its own
 * chunk instead of the main bundle (see levels.data.ts). The top-level `await` here gates module
 * evaluation: anything importing this loader — notably the game store, which builds the resume board
 * at construction — won't finish initializing until the data is in, so `getLevel` and friends below
 * stay fully synchronous. The data is fetched once during boot (and precached by the service worker).
 */
const { BAKED_LEVELS } = await import('./levels.data');

// Live generation runs in the Rust core (Track F5 — the JS generator/solver are test-only
// oracles now), so instantiate the wasm before any `getLevel` can need it. Module evaluation
// already awaits the baked-data import above, so this adds one small parallel-ish await to
// boot. In tests the setup file has already `initCoreWasmSync`'d, making this a no-op; if it
// ever genuinely fails (blocked fetch), baked levels still load and the live path throws a
// clear error instead of silently degrading.
await initCoreWasm();

/**
 * A single playable board for a campaign level, uncached (tests exercise per-chapter
 * generation with this; the app path is `getLevel`, which memoizes). Since F5 this runs the
 * core's pick loop like every other live board — the old JS "light path" went with the JS
 * generator.
 */
export function generateForLevel(level: number): LoadedLevel {
  return pickBest(level, planForLevel(level), targetPercentile(level));
}

/**
 * Live-generation budget (coarse-to-fine best-of-N; a spinner covers it, so instant is not required):
 *
 * - `poolSize` — the COARSE pool, scored cheaply (proxy optimal, no dead-end sampling) to narrow
 *   hundreds of boards to the few nearest the curve target.
 * - `finalists` — those few are re-scored in the FINE pass with dead-end sampling and the best fit wins.
 * - `fineDeadEndSamples` — random playouts per finalist in that fine pass.
 *
 * Production ({@link DEFAULT_LIVE_CONFIG}) is sized to land well under a ~1.5s phone budget even on the
 * slowest shape; the test suite installs a tiny budget ({@link TEST_LIVE_CONFIG}) so specs stay fast —
 * the selection logic is identical, only the breadth differs (tests don't assert on specific tail
 * boards). Injecting the budget from the test SETUP (see `src/test/setup.ts` → {@link configureLiveGenerator})
 * keeps production code free of any test-runner awareness — there is no `process.env` sniff here.
 */
export interface LiveGenConfig {
  /** Coarse pool size, scored cheaply to narrow to the finalists. */
  poolSize: number;
  /** Finalists re-scored in the fine pass with dead-end sampling. */
  finalists: number;
  /** Dead-end playouts per finalist in the fine pass. */
  fineDeadEndSamples: number;
}

/** Production budget — the default until something installs another. */
export const DEFAULT_LIVE_CONFIG: LiveGenConfig = { poolSize: 600, finalists: 30, fineDeadEndSamples: 24 };
/** Tiny budget the test setup installs so the suite stays fast. */
export const TEST_LIVE_CONFIG: LiveGenConfig = { poolSize: 24, finalists: 6, fineDeadEndSamples: 6 };

/** The active budget. Mutated only through {@link configureLiveGenerator} (default = production). */
let liveConfig: LiveGenConfig = DEFAULT_LIVE_CONFIG;

/** Memoized live levels (deterministic by level), so re-loads and replays don't regenerate. */
const liveCache = new Map<number, LoadedLevel>();

/** Install a live-generation budget and clear the caches (the test setup shrinks the pool this way). */
export function configureLiveGenerator(config: LiveGenConfig): void {
  liveConfig = config;
  liveCache.clear();
  dailyCache.clear();
}

/** Clear the memoized live levels — for test isolation between specs that exercise live generation. */
export function resetLiveGenerator(): void {
  liveCache.clear();
  dailyCache.clear();
}

/** What the last board load did — the E9 diagnostics readout's payload. */
export interface LoadDiagnostics {
  /** Which board: `L245`, `daily 2026-07-04`, `random 7`. */
  label: string;
  /** Committed data vs the core's live generator (cache hits count as live — same path). */
  source: 'baked' | 'live';
  ms: number;
}

let lastLoad: LoadDiagnostics | null = null;
const recordLoad = (label: string, source: LoadDiagnostics['source'], started: number): void => {
  lastLoad = { label, source, ms: Math.round(performance.now() - started) };
};

/** Snapshot for the admin diagnostics readout (Track E9): last load + cache sizes + budget. */
export function loadDiagnostics(): {
  last: LoadDiagnostics | null;
  liveCacheSize: number;
  dailyCacheSize: number;
  config: LiveGenConfig;
} {
  return { last: lastLoad, liveCacheSize: liveCache.size, dailyCacheSize: dailyCache.size, config: liveConfig };
}

/**
 * The shape family for a plan's footprint. Live boards carry no committed family, but every live plan's
 * footprint comes from a {@link SHAPES} entry, so we recover it by matching colors/bottles/capacity
 * (each footprint is unique across SHAPES). Falls back to `'live'` if no shape matches.
 */
function familyForPlan(plan: LevelPlan): string {
  const shape = SHAPES.find(
    (s) => s.colors === plan.colors && s.bottles === plan.bottles && s.capacity === plan.capacity,
  );
  return shape?.family ?? 'live';
}

/**
 * Coarse-to-fine best-of-N, run entirely in the Rust core (Track F5 — the JS twin of this
 * loop was retired with the rest of the JS solver): sample a pool from `plan`, cheap-score it
 * to the finalists nearest the curve `target`, re-score those with dead-end sampling, pick
 * the best fit, and return it with its star cutoffs and provenance. The budget (`liveConfig`)
 * stays a JS-side knob passed through the boundary.
 */
function pickBest(level: number, plan: LevelPlan, target: number): LoadedLevel {
  const picked = wasmPickBest(plan, target, liveConfig);
  if (!picked) {
    // Only two ways here: the wasm never initialized (blocked fetch — baked levels still
    // work), or every salted pool came up empty (practically impossible for the SHAPES menu).
    throw new Error(
      `live generation failed for level ${level} (core ${coreWasmReady() ? 'ready' : 'unavailable'})`,
    );
  }
  return {
    state: picked.state,
    colors: plan.colors,
    bottles: plan.bottles,
    capacity: plan.capacity,
    solution: picked.solution,
    minMoves: picked.minMoves,
    par: picked.par,
    seed: picked.seed,
    level,
    chapter: plan.chapter,
    phase: plan.phase,
    mechanics: plan.mechanics,
    hidden: picked.hidden,
    funnels: picked.funnels,
    ice: picked.ice,
    optimal: picked.optimal,
    twoStarMax: picked.twoStarMax,
    liveProvenance: {
      score: picked.score,
      targetPercentile: target,
      family: familyForPlan(plan),
      metrics: picked.metrics,
    },
  };
}

/**
 * The higher-quality live board for a campaign tail level: best-of-N at the level's curve target,
 * memoized so re-loads and replays don't regenerate.
 */
function generateBestLevel(level: number): LoadedLevel {
  const cached = liveCache.get(level);
  if (cached) return cached;
  const result = pickBest(level, planForLevel(level), targetPercentile(level));
  liveCache.set(level, result);
  return result;
}

/** Hard-leaning shapes the random mode draws from (mirrors progression's live-shape filter, incl. the capacity-10 cap). */
const RANDOM_SHAPES = SHAPES.filter(
  (s) => s.family === 'large' || (s.family === 'tall' && s.capacity >= 8 && s.capacity <= 10),
);

/** The normal→hard slice of the difficulty curve the post-campaign random boards target. */
const RANDOM_TARGET_MIN = 0.45;
const RANDOM_TARGET_MAX = 0.95;

/**
 * The difficulty bucket for a raw curve percentile (0..1). Mirrors `phaseForLevel`'s thirds, but
 * lives here (the load path) rather than `progression.ts` so deriving a random board's phase doesn't
 * touch the bake-hashed config and force a campaign re-bake.
 */
function phaseForTarget(p: number): Difficulty {
  if (p < 1 / 3) return 'easy';
  if (p < 2 / 3) return 'normal';
  return 'hard';
}

/** A deterministic fraction in [0, 1) from `seed`, decorrelated per `stream` so independent draws don't track each other. */
function seedFraction(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 2 ** 32;
}

/**
 * A one-off board for the post-campaign "Play Random" mode: a hard-shaped footprint (varied by
 * `seed`) at a normal→hard difficulty drawn from the curve, with the hidden-colors mechanic toggled
 * per board so the run isn't a relentless wall of the same max-difficulty board. NOT memoized — each
 * call is a fresh random board, picked best-of-N at its sampled target.
 */
export function generateRandomLevel(seed: number): LoadedLevel {
  const shape = RANDOM_SHAPES[Math.abs(seed) % RANDOM_SHAPES.length]!;
  // Spread difficulty across the normal→hard band instead of pinning every board to the top.
  const target = RANDOM_TARGET_MIN + seedFraction(seed, 1) * (RANDOM_TARGET_MAX - RANDOM_TARGET_MIN);
  // Vary the mechanics per board: each cumulative mechanic of the top chapter is toggled independently
  // (≈half the boards carry it), for genuine variety rather than the hardest stack of mechanics on every
  // board. A BALANCED density (no chapter signature) applies whichever survive at an even moderate rate,
  // so the endless mode samples all mechanics evenly instead of spotlighting one.
  const full = mechanicsForLevel(CHAPTER_LEN * 1_000_000); // clamps to the last defined chapter
  let mechanics = full;
  if (seedFraction(seed, 2) >= 0.5) mechanics = mechanics.filter((m) => m !== 'hidden');
  if (seedFraction(seed, 3) >= 0.5) mechanics = mechanics.filter((m) => m !== 'funnel');
  if (seedFraction(seed, 4) >= 0.5) mechanics = mechanics.filter((m) => m !== 'ice');
  const plan: LevelPlan = {
    level: 0, // sentinel — random boards are not campaign levels
    chapter: chapterForLevel(CHAPTER_LEN * 1_000_000),
    phase: phaseForTarget(target),
    colors: shape.colors,
    bottles: shape.bottles,
    capacity: shape.capacity,
    seed: seed >>> 0,
    minPar: 0,
    parMode: 'proxy',
    mechanics,
    density: balancedDensity(),
  };
  const started = performance.now();
  const result = pickBest(0, plan, target);
  recordLoad(`random ${seed}`, 'live', started);
  return result;
}

/**
 * Mid/hard showcase shapes the daily challenge draws from: medium and large boards plus the compact
 * tall variants — no trivial 5×4 starter shapes. A daily is a showcase, so it skips the easy footprints
 * but isn't pinned to the single hardest 15-tube board every day either.
 */
const DAILY_SHAPES = SHAPES.filter(
  (s) =>
    s.family === 'medium' ||
    s.family === 'large' ||
    (s.family === 'tall' && s.capacity >= 6 && s.capacity <= 10),
);

/** The daily's difficulty band — a mid→hard slice of the curve (a showcase, not the absolute wall every day). */
const DAILY_TARGET_MIN = 0.5;
const DAILY_TARGET_MAX = 0.85;

/** Memoized daily boards keyed by UTC date string, so re-opening today's daily doesn't regenerate. */
const dailyCache = new Map<string, LoadedLevel>();

/**
 * The date-seeded daily challenge board (Track B2): a mid/hard showcase using the FULL mechanic set
 * and balanced density, picked best-of-N from a seed derived purely from the UTC date `key` — so every
 * device computes the same board for a given day with no server. The daily ignores campaign progress
 * by design (it must be identical across devices), so it always carries every mechanic. Memoized per
 * date key. The footprint and difficulty target vary by date for day-to-day variety.
 */
export function generateDailyLevel(key: string): LoadedLevel {
  const cached = dailyCache.get(key);
  if (cached) return cached;
  const seed = dailySeed(key);
  const shape = DAILY_SHAPES[seed % DAILY_SHAPES.length]!;
  const target = DAILY_TARGET_MIN + seedFraction(seed, 1) * (DAILY_TARGET_MAX - DAILY_TARGET_MIN);
  const plan: LevelPlan = {
    level: 0, // sentinel — the daily is not a campaign level
    chapter: chapterForLevel(CAMPAIGN_LENGTH),
    phase: phaseForTarget(target),
    colors: shape.colors,
    bottles: shape.bottles,
    capacity: shape.capacity,
    seed,
    minPar: 0,
    parMode: 'proxy',
    mechanics: mechanicsForLevel(CAMPAIGN_LENGTH), // full set — a daily showcases every mechanic
    density: balancedDensity(),
  };
  const started = performance.now();
  const result = pickBest(0, plan, target);
  dailyCache.set(key, result);
  recordLoad(`daily ${key}`, 'live', started);
  return result;
}

/** Whether a level has a committed pre-baked board (vs. being generated live). */
export function hasBakedLevel(level: number): boolean {
  return BAKED_BY_LEVEL.has(level);
}

/** Index of the baked campaign by level number. Empty until `npm run build:levels` has run. */
const BAKED_BY_LEVEL = new Map<number, BakedLevel>(BAKED_LEVELS.map((l) => [l.level, l]));

/** How many campaign levels are pre-baked — the endless mode unlocks once the player clears them all. */
export const BAKED_LEVEL_COUNT = BAKED_LEVELS.length;

/** Convert committed static data into the same `PlayableLevel` shape the generator produces. */
function bakedToPlayable(baked: BakedLevel): PlayableLevel {
  const state: GameState = {
    bottles: baked.bottles.map(toColors),
    capacity: baked.capacity,
  };
  // Footprint comes from the baked board itself now (it's no longer a function of the level number).
  const colors = new Set<string>(baked.bottles.flat()).size;
  const overlays = deserializeOverlays(baked); // brands the committed hidden/funnels/ice grids
  return {
    state,
    colors,
    bottles: baked.bottles.length,
    capacity: baked.capacity,
    // Baked levels carry no stored solution/seed (unused at runtime — see baked.ts).
    solution: [],
    minMoves: baked.optimal,
    par: baked.par,
    seed: seedForLevel(baked.level),
    level: baked.level,
    chapter: chapterForLevel(baked.level),
    phase: baked.phase,
    mechanics: baked.mechanics,
    hidden: overlays.hidden,
    funnels: overlays.funnels,
    ice: overlays.ice,
    optimal: baked.optimal,
    twoStarMax: baked.twoStarMax,
  };
}

/**
 * The runtime entry point for loading a level: a pre-baked board if one was committed for this level,
 * otherwise the higher-quality live generator (`generateBestLevel`) for the endless plateau tail and
 * any un-baked level. The live path can take up to ~1–2s, so callers should show a spinner (the
 * store defers it behind a loading flag). Prefer this over `generateForLevel` in app code.
 */
export function getLevel(level: number): LoadedLevel {
  const started = performance.now();
  const baked = BAKED_BY_LEVEL.get(level);
  const loaded = baked ? bakedToPlayable(baked) : generateBestLevel(level);
  recordLoad(`L${level}`, baked ? 'baked' : 'live', started);
  return loaded;
}
