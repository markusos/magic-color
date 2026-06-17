/**
 * The campaign: a single linear track of levels. The global level number (1-based) maps
 * deterministically to a board via a **footprint ladder** that sweeps Easy -> Normal -> Hard
 * by growing tubes/colors, and to a **chapter** that re-runs the ladder under a cumulative
 * mechanic set. Everything here is pure — `planForLevel` is a total function of the level
 * number, so a given level is the same board for everyone, forever (modulo generator
 * versioning).
 *
 * Persistence stores only the level number; the board is regenerated from its seed on demand.
 */
import { generateLevel } from './generator';
import {
  cappedSolveMoves,
  computeHidden,
  emptyGrid,
  exposableCells,
  type HiddenGrid,
} from './hidden';
import { optimalCappedMoves } from './search';
import type { Difficulty, GeneratedLevel, Mechanic, ParMode } from './types';

/** One rung of the difficulty ladder: a fixed footprint plus its phase label. */
interface Rung {
  colors: number;
  bottles: number;
  capacity: number;
  phase: Difficulty;
}

/**
 * The footprint ladder, easy -> hard. `bottles - colors` is the number of empty tubes.
 * Capacity stays at 4 for now (a per-rung field so taller-tube milestones can slot in later).
 * Tuning the curve = editing this table and `LEVELS_PER_RUNG`.
 */
const LADDER: readonly Rung[] = [
  // Easy: fixed 5 tubes. 2 empty -> 1 empty.
  { colors: 3, bottles: 5, capacity: 4, phase: 'easy' },
  { colors: 4, bottles: 5, capacity: 4, phase: 'easy' },
  // Normal: fixed 10 tubes. 3 empty -> 2 empty.
  { colors: 7, bottles: 10, capacity: 4, phase: 'normal' },
  { colors: 8, bottles: 10, capacity: 4, phase: 'normal' },
  // Hard: fixed 15 tubes. Only 3 empty (12 colors) is possible — 2 empty would need 13
  // colors, one more than the palette holds.
  { colors: 12, bottles: 15, capacity: 4, phase: 'hard' },
];

/** How many seed-varied levels are spent on each rung before stepping up. */
const LEVELS_PER_RUNG = 17;

/**
 * Levels in one Easy -> Hard sweep (one chapter). Chapter 1 therefore begins at level
 * `CHAPTER_LEN + 1` (= 75). The last rung simply absorbs whatever levels remain in the chapter
 * when this isn't a clean multiple of `LADDER.length * LEVELS_PER_RUNG`.
 */
export const CHAPTER_LEN = 74;

/**
 * Cumulative mechanic sets, indexed by chapter. Chapter 0 is the base game; chapter 1 adds the
 * hidden-colors mechanic and re-runs the Easy->Hard ladder with it on top. Past the last
 * defined chapter, play plateaus at that chapter's top rung (see `planForLevel`).
 */
const MECHANIC_SETS: readonly (readonly Mechanic[])[] = [
  [], // chapter 0 — base game
  ['hidden'], // chapter 1 — + hidden colors
];

/** Highest chapter we actually have content for. */
const DEFINED_CHAPTERS = MECHANIC_SETS.length;

/**
 * xmur3 string hash -> a 32-bit seed. Mixing the level number (rather than using it raw)
 * decorrelates adjacent levels so consecutive boards share no structure.
 */
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic seed for a level. `salt` is bumped only when generation fails (see below). */
export function seedForLevel(level: number, salt = 0): number {
  return xmur3(`magic-color:L${level}:${salt}`);
}

/** Par floor for a level: reject trivial boards, ramping mildly across the chapter. */
function parFloorFor(colors: number, posInChapter: number): number {
  const base = Math.round(colors * 1.3);
  const ramp = Math.round((posInChapter / CHAPTER_LEN) * colors * 0.8);
  return base + ramp;
}

/** The full recipe for a level: footprint, chapter/phase, seed, and par/generation knobs. */
export interface LevelPlan {
  level: number;
  chapter: number;
  phase: Difficulty;
  colors: number;
  bottles: number;
  capacity: number;
  seed: number;
  minPar: number;
  parMode: ParMode;
  mechanics: readonly Mechanic[];
}

/** A generated, playable level annotated with its campaign metadata. */
export interface PlayableLevel extends GeneratedLevel {
  level: number;
  chapter: number;
  phase: Difficulty;
  mechanics: readonly Mechanic[];
  /** Initial concealment overlay (all-false unless this chapter has the `hidden` mechanic). */
  hidden: HiddenGrid;
  /**
   * Achievable near-optimal move count (the solution replayed under the real capped/reveal
   * rules). Basis for star thresholds — see `stars.ts`. Differs from `minMoves` (bulk solution
   * length) on hidden levels, where capping forces more, smaller pours.
   */
  optimal: number;
}

/**
 * Pure level -> recipe mapping. Beyond the last *defined* chapter we deliberately do NOT
 * restart the ladder (that would feel like a demotion with no new mechanic to justify it):
 * instead we clamp to the final chapter's top rung, so play plateaus at Hard with endless
 * seed variety until a new mechanic ships.
 */
export function planForLevel(level: number): LevelPlan {
  const idx = Math.max(0, Math.floor(level) - 1);
  let chapter = Math.floor(idx / CHAPTER_LEN);
  let posInChapter = idx % CHAPTER_LEN;

  if (chapter >= DEFINED_CHAPTERS) {
    chapter = DEFINED_CHAPTERS - 1;
    posInChapter = CHAPTER_LEN - 1; // pin to the top rung (plateau)
  }

  const rungIndex = Math.min(Math.floor(posInChapter / LEVELS_PER_RUNG), LADDER.length - 1);
  const rung = LADDER[rungIndex]!;

  return {
    level,
    chapter,
    phase: rung.phase,
    colors: rung.colors,
    bottles: rung.bottles,
    capacity: rung.capacity,
    seed: seedForLevel(level),
    minPar: parFloorFor(rung.colors, posInChapter),
    // Exact par only for the small Easy boards (5 tubes); exact BFS explodes on the bigger
    // Normal/Hard boards (especially with extra empty tubes), so they use the cheap DFS proxy.
    parMode: rung.bottles <= 6 ? 'optimal' : 'proxy',
    mechanics: MECHANIC_SETS[chapter]!,
  };
}

/** Largest board (in bottles) for which we attempt the exact optimal at load time. */
const EXACT_OPTIMAL_MAX_BOTTLES = 10;

/**
 * The level's star reference (achievable near-optimal player pours). For small boards (Easy /
 * Normal) we compute the EXACT hidden-aware minimum via A*. Big boards (Hard, 15 tubes) are
 * NP-hard to solve exactly and would stall the load, so we skip straight to a fast, safe upper
 * bound: the stored solution replayed under the capped/reveal rules.
 */
function optimalFor(
  state: GeneratedLevel['state'],
  solution: GeneratedLevel['solution'],
  hidden: HiddenGrid,
  bottles: number,
): number {
  if (bottles <= EXACT_OPTIMAL_MAX_BOTTLES) {
    const exact = optimalCappedMoves(state, hidden);
    if (exact !== null) return exact;
  }
  return cappedSolveMoves(state, solution, hidden);
}

/**
 * Generate the playable board for a level. Robust to the (rare) case where a seed fails to
 * yield a solvable board within the generator's retries: it deterministically bumps the salt
 * and retries, so no level number is ever a dead end.
 */
export function generateForLevel(level: number): PlayableLevel {
  const plan = planForLevel(level);

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
      const hidden = plan.mechanics.includes('hidden')
        ? computeHidden(
            generated.state,
            plan.seed,
            exposableCells(generated.state, generated.solution),
          )
        : emptyGrid(generated.state);
      return {
        ...generated,
        level,
        chapter: plan.chapter,
        phase: plan.phase,
        mechanics: plan.mechanics,
        hidden,
        optimal: optimalFor(generated.state, generated.solution, hidden, generated.bottles),
      };
    } catch {
      // Extremely unlikely; try a different seed for this same level.
    }
  }

  throw new Error(`Failed to generate level ${level} after salting`);
}
