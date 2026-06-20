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
import { assignSlots, compositeScores, measureMetrics } from './difficulty';
import { DEFAULT_CAPACITY, generateCandidates, generateLevel } from './generator';
import { cappedSolveMoves, computeHidden, emptyGrid, exposableCells, type HiddenGrid } from './hidden';
import { BAKED_LEVELS } from './levels.data';
import {
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
import { optimalCappedMoves } from './search';
import type { Color, GameState, GeneratedLevel } from './types';

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
function optimalFor(
  state: GeneratedLevel['state'],
  solution: GeneratedLevel['solution'],
  hidden: HiddenGrid,
  bottles: number,
  capacity: number,
): number {
  if (bottles <= EXACT_OPTIMAL_MAX_BOTTLES && capacity <= DEFAULT_CAPACITY) {
    const exact = optimalCappedMoves(state, hidden);
    if (exact !== null) return exact;
  }
  return cappedSolveMoves(state, solution, hidden);
}

/** The initial concealment overlay for a generated board (all-false outside the hidden chapter). */
function hiddenFor(plan: LevelPlan, generated: GeneratedLevel): HiddenGrid {
  return plan.mechanics.includes('hidden')
    ? computeHidden(generated.state, plan.seed, exposableCells(generated.state, generated.solution))
    : emptyGrid(generated.state);
}

/** Wrap a generated board + its concealment as a campaign-annotated `PlayableLevel`. */
function toPlayable(level: number, plan: LevelPlan, generated: GeneratedLevel, hidden: HiddenGrid): PlayableLevel {
  return {
    ...generated,
    level,
    chapter: plan.chapter,
    phase: plan.phase,
    mechanics: plan.mechanics,
    hidden,
    optimal: optimalFor(generated.state, generated.solution, hidden, generated.bottles, generated.capacity),
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
      return toPlayable(level, plan, generated, hiddenFor(plan, generated));
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
 * How many candidate boards the live quality path samples before picking. In production this is
 * tuned to a ~1–2s generation budget on a phone (instant is no longer required — a spinner covers
 * it), even on the slowest shape (the dense tall 5-tube board). Bigger ⇒ better picks, slower
 * generation. Under tests we use a tiny pool so the suite stays fast: the selection logic is
 * identical, only the breadth differs (tests don't assert on specific tail boards). The guard is
 * safe everywhere — `process` is undefined in the production browser bundle (⇒ full budget), and the
 * tsx bake never calls this path. */
const IN_TEST = typeof process !== 'undefined' && process.env?.VITEST === 'true';
const LIVE_POOL_SIZE = IN_TEST ? 24 : 250;

/** Memoized live levels (deterministic by level), so re-loads and replays don't regenerate. */
const liveCache = new Map<number, PlayableLevel>();

/**
 * Best-of-N: sample a pool of candidates from `plan` and pick the one whose size-normalized
 * difficulty best fits `target` on the curve (the same scorer the offline bake uses, minus the
 * expensive dead-end sampling — too slow for a per-load budget). Falls back to the light generator if
 * the pool ever comes up empty.
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
      LIVE_POOL_SIZE,
    );
    if (candidates.length === 0) continue;

    const built = candidates.map((g) => ({ g, hidden: hiddenFor(plan, g) }));
    const scores = compositeScores(
      // Cheap scoring: proxy optimal (no A*) and no dead-end sampling, to honor the load budget.
      built.map(({ g, hidden }) =>
        measureMetrics(g.state, hidden, g.solution, { optimalNodeBudget: 0, deadEndSamples: 0 }),
      ),
    );
    const idx = assignSlots(scores.map((score) => ({ score, family: 'live' })), [target])[0]!;
    const chosen = built[idx]!;
    return toPlayable(level, plan, chosen.g, chosen.hidden);
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

/** Hard-leaning shapes the endless mode draws from (mirrors progression's live-shape filter). */
const HARD_SHAPES = SHAPES.filter((s) => s.family === 'large' || (s.family === 'tall' && s.capacity >= 8));

/**
 * A one-off "random hard" board for the post-campaign endless mode: a hard-shaped footprint (varied
 * by `seed`) carrying the UNION of every defined chapter's mechanics, picked best-of-N near the top
 * of the difficulty curve. NOT memoized — each call is a fresh random board. The union is just the
 * last defined chapter's mechanic set, since `MECHANIC_SETS` is cumulative.
 */
export function generateRandomHard(seed: number): PlayableLevel {
  const shape = HARD_SHAPES[Math.abs(seed) % HARD_SHAPES.length]!;
  const allMechanics = mechanicsForLevel(CHAPTER_LEN * 1_000_000); // clamps to the last defined chapter
  const plan: LevelPlan = {
    level: 0, // sentinel — endless boards are not campaign levels
    chapter: chapterForLevel(CHAPTER_LEN * 1_000_000),
    phase: 'hard',
    colors: shape.colors,
    bottles: shape.bottles,
    capacity: shape.capacity,
    seed: seed >>> 0,
    minPar: 0,
    parMode: 'proxy',
    mechanics: allMechanics,
  };
  return pickBest(0, plan, 0.97);
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
    bottles: baked.bottles.map((col) => col.slice() as Color[]),
    capacity: baked.capacity,
  };
  // Footprint comes from the baked board itself now (it's no longer a function of the level number).
  const colors = new Set<string>(baked.bottles.flat()).size;
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
    hidden: baked.hidden,
    optimal: baked.optimal,
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
