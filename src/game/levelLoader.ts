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
import { assignSlots, compositeScores, measureMetrics, type MetricOptions } from './difficulty';
import {
  buildOverlays,
  deserializeOverlays,
  staticOverlays,
  type OverlaySet,
} from './mechanics';
import { DEFAULT_CAPACITY, generateCandidates, generateLevel } from './generator';
import { cappedSolveMoves } from './hidden';
import { BAKED_LEVELS } from './levels.data';
import {
  balancedDensity,
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
import { nearOptimalCutoffs, optimalCappedMoves } from './search';
import { type Difficulty, type GameState, type GeneratedLevel, toColors } from './types';

/**
 * Largest board (in bottles) for which we attempt the exact optimal at load time. Kept to small,
 * STANDARD-height boards (≤8 tubes, capacity ≤ 4): the exact A* stays cheap there, but on bigger
 * boards it costs tens-to-hundreds of ms, and on tall (capacity > 4) boards the deeper search blows
 * up too — so those skip straight to the fast upper bound. (This only affects the live path; baked
 * levels carry an exact `optimal` computed offline.)
 */
const EXACT_OPTIMAL_MAX_BOTTLES = 8;

/**
 * The live level's star reference (achievable near-optimal player pours). For small standard-height
 * boards we compute the EXACT hidden-aware minimum via A*. Bigger or taller boards are expensive
 * (NP-hard, worse under concealment) and would stall the load, so we use a fast, safe upper bound:
 * the stored solution replayed under the capped/reveal rules.
 */
function optimalFor(generated: GeneratedLevel, overlays: OverlaySet): number {
  const { state, solution, bottles, capacity } = generated;
  if (bottles <= EXACT_OPTIMAL_MAX_BOTTLES && capacity <= DEFAULT_CAPACITY) {
    const exact = optimalCappedMoves(state, overlays.hidden, undefined, staticOverlays(overlays));
    if (exact !== null) return exact;
  }
  // The stored solution is funnel- and ice-legal by construction, so it's still a valid upper bound.
  return cappedSolveMoves(state, solution, overlays.hidden);
}

/**
 * The live level's star cutoffs (3★ `optimal`, 2★ `twoStarMax`). On small standard-height boards the
 * tier sweep is cheap and yields the adjusted near-optimal band; on bigger/taller boards (where the
 * sweep would stall the load) we fall back to the proxy optimal with a `+2` band — matching how the
 * bake degrades on the few boards its own exact search can't crack.
 */
function cutoffsFor(
  generated: GeneratedLevel,
  overlays: OverlaySet,
): { optimal: number; twoStarMax: number } {
  const { state, bottles, capacity } = generated;
  const optimal = optimalFor(generated, overlays);
  if (bottles <= EXACT_OPTIMAL_MAX_BOTTLES && capacity <= DEFAULT_CAPACITY) {
    const tiers = nearOptimalCutoffs(state, overlays.hidden, undefined, staticOverlays(overlays));
    if (tiers && tiers.optimal === optimal) return tiers;
  }
  return { optimal, twoStarMax: optimal + 2 };
}

/**
 * The initial overlay set for a generated board: each active mechanic built from the stored solution
 * (so the board stays solvable by construction), all-clear for mechanics this chapter doesn't use. See
 * {@link buildOverlays} — a new mechanic plugs in via the registry, with no change here.
 */
function overlaysFor(plan: LevelPlan, generated: GeneratedLevel): OverlaySet {
  return buildOverlays(plan.mechanics, {
    state: generated.state,
    solution: generated.solution,
    seed: plan.seed,
    density: plan.density,
  });
}

/** Wrap a generated board + its overlay set as a campaign-annotated `PlayableLevel`. */
function toPlayable(
  level: number,
  plan: LevelPlan,
  generated: GeneratedLevel,
  overlays: OverlaySet,
): PlayableLevel {
  const { optimal, twoStarMax } = cutoffsFor(generated, overlays);
  return {
    ...generated,
    level,
    chapter: plan.chapter,
    phase: plan.phase,
    mechanics: plan.mechanics,
    hidden: overlays.hidden,
    funnels: overlays.funnels,
    ice: overlays.ice,
    optimal,
    twoStarMax,
  };
}

/**
 * Generate a single playable board from a `plan` (the LIGHT path): accept the first board over the par
 * floor. Robust to the (rare) seed that fails to yield a solvable board — it bumps the salt and
 * retries. Backs `generateForLevel` and is the fallback for the pooled quality path.
 */
function generateFromPlan(level: number, plan: LevelPlan): PlayableLevel {
  for (let salt = 0; salt < 8; salt++) {
    try {
      const generated = generateLevel({
        colors: plan.colors,
        bottles: plan.bottles,
        capacity: plan.capacity,
        seed: salt === 0 ? plan.seed : seedForLevel(level, salt),
        minPar: plan.minPar,
        parMode: plan.parMode,
      });
      return toPlayable(level, plan, generated, overlaysFor(plan, generated));
    } catch {
      // Extremely unlikely; try a different seed for this same plan.
    }
  }

  throw new Error(`Failed to generate level ${level} after salting`);
}

/** The light single-board generator for a campaign level. Used by tests and the bake fallback. */
export function generateForLevel(level: number): PlayableLevel {
  return generateFromPlan(level, planForLevel(level));
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
const liveCache = new Map<number, PlayableLevel>();

/** Install a live-generation budget and clear the cache (the test setup shrinks the pool this way). */
export function configureLiveGenerator(config: LiveGenConfig): void {
  liveConfig = config;
  liveCache.clear();
}

/** Clear the memoized live levels — for test isolation between specs that exercise live generation. */
export function resetLiveGenerator(): void {
  liveCache.clear();
}

/** Coarse scoring: proxy optimal (no A*) and no dead-end sampling, to scan the big pool cheaply. */
const CHEAP_METRICS: MetricOptions = { optimalNodeBudget: 0, tierNodeBudget: 0, deadEndSamples: 0 };
/**
 * Fine scoring for the current budget: dead-end-density sampling on the finalists only. We deliberately
 * keep the proxy optimal (`optimalNodeBudget: 0`) rather than the exact A* — the A* is 40–65× more
 * expensive and *explodes* on the hidden 10-tube boards the random mode produces, whereas dead-end
 * sampling is ~2 ms/board regardless of concealment and is the heaviest-weighted term in the scorer.
 */
function fineMetrics(): MetricOptions {
  return {
    optimalNodeBudget: 0,
    tierNodeBudget: 0,
    deadEndSamples: liveConfig.fineDeadEndSamples,
    deadEndNodeBudget: 12_000,
  };
}

/** Score at percentile `p` of `scores` (mirrors `difficulty.quantile`, which isn't exported). */
function percentileScore(scores: number[], p: number): number {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]!;
}

/**
 * Coarse-to-fine best-of-N: sample a big pool from `plan`, cheaply rank it to the few finalists
 * nearest the curve `target`, then re-score those finalists with the heavier dead-end signal and pick
 * the best fit (the same scorer the offline bake uses, but with the exact-optimal A* swapped for the
 * proxy — too slow/explosive for a per-load budget). Falls back to the light generator if the pool
 * ever comes up empty.
 */
function pickBest(level: number, plan: LevelPlan, target: number): PlayableLevel {
  for (let salt = 0; salt < 8; salt++) {
    const candidates = generateCandidates(
      {
        colors: plan.colors,
        bottles: plan.bottles,
        capacity: plan.capacity,
        seed: salt === 0 ? plan.seed : seedForLevel(level, salt),
      },
      liveConfig.poolSize,
    );
    if (candidates.length === 0) continue;

    const built = candidates.map((g) => ({ g, overlays: overlaysFor(plan, g) }));

    // Coarse pass: cheap-score the whole pool and keep the finalists nearest the curve target —
    // narrowing hundreds of boards to a handful at roughly the right difficulty.
    const coarse = compositeScores(
      built.map(({ g, overlays }) =>
        measureMetrics(g.state, overlays.hidden, g.solution, CHEAP_METRICS, staticOverlays(overlays)),
      ),
    );
    const coarseTarget = percentileScore(coarse, target);
    const finalists = built
      .map((b, i) => ({ b, dist: Math.abs(coarse[i]! - coarseTarget) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, Math.min(liveConfig.finalists, built.length))
      .map((x) => x.b);

    // Fine pass: re-score the finalists with dead-end sampling (the strongest signal, absent above)
    // and pick the best fit on the curve.
    const fineOpts = fineMetrics();
    const fine = compositeScores(
      finalists.map(({ g, overlays }) =>
        measureMetrics(g.state, overlays.hidden, g.solution, fineOpts, staticOverlays(overlays)),
      ),
    );
    const idx = assignSlots(fine.map((score) => ({ score, family: 'live' })), [target])[0]!;
    const chosen = finalists[idx]!;
    return toPlayable(level, plan, chosen.g, chosen.overlays);
  }

  return generateFromPlan(level, plan); // pool kept failing — fall back to the light generator
}

/**
 * The higher-quality live board for a campaign tail level: best-of-N at the level's curve target,
 * memoized so re-loads and replays don't regenerate.
 */
function generateBestLevel(level: number): PlayableLevel {
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
export function generateRandomLevel(seed: number): PlayableLevel {
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
  return pickBest(0, plan, target);
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
export function getLevel(level: number): PlayableLevel {
  const baked = BAKED_BY_LEVEL.get(level);
  return baked ? bakedToPlayable(baked) : generateBestLevel(level);
}
