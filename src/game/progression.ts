/**
 * The campaign CONFIG: the bake-relevant pure definition of a single linear track of levels grouped
 * into **chapters** (each chapter adds a cumulative mechanic). Difficulty is **decoupled from board
 * size** (v2, see PLAN.md): a level's difficulty comes from where it sits on the per-chapter ease-in
 * curve (`targetPercentile`), NOT from its tube count. Board *shape* is just variety —
 * small/tall/medium/large all appear across a chapter, mixed within each difficulty band.
 *
 * Levels 1..N are **pre-baked** offline (`scripts/build-levels.ts` → `levels.data.ts`) by generating
 * a big pool across all shapes (the `SHAPES` menu), scoring each by a size-normalized difficulty
 * score, and assigning boards to the curve. Past the baked range (the plateau tail) and for the
 * endless mode, boards are generated live from the shape menu at high difficulty.
 *
 * Everything here feeds the bake's board OUTPUT, so the staleness guard (`scripts/levelVersion.ts`)
 * hashes this file. The runtime LOADING path (`getLevel`, the live generator, baked deserialization)
 * lives in `levelLoader.ts` so that tuning it does NOT force a re-bake.
 */
import { DEFAULT_CAPACITY } from './generator';
import type { HiddenGrid } from './hidden';
import type { Difficulty, GeneratedLevel, Mechanic, ParMode } from './types';

/** A board footprint the bake draws candidates from. `family` groups shapes for variety rotation. */
export interface Shape {
  family: 'small' | 'tall' | 'medium' | 'large';
  /** Number of tubes. */
  bottles: number;
  /** Number of distinct colors (each fills `capacity` cells). */
  colors: number;
  capacity: number;
}

/**
 * The shape menu (v2): the footprints the offline bake samples candidates from, spanning small,
 * tall (5-tube only, capacity swept up to 10 — a compact hard variation), medium, and large. This
 * is NOT a difficulty ladder — difficulty comes from the curve + per-board scoring; this is purely
 * the variety of board shapes that can appear at any difficulty. Every entry keeps `bottles - colors
 * >= 1` (at least one empty tube) so it's generatable. Capacity is capped at 10: a capacity-12 tube
 * gets too cramped and can clip/crowd neighbours on small screens, so it's served nowhere — baked or
 * live (see LIVE_SHAPES/RANDOM_SHAPES, which also enforce the cap).
 */
export const SHAPES: readonly Shape[] = [
  // Small classic (5 tubes, standard height).
  { family: 'small', bottles: 5, colors: 3, capacity: 4 },
  { family: 'small', bottles: 5, colors: 4, capacity: 4 },
  // Small TALL (5 tubes only): few tubes, very dense — hard in a compact footprint.
  { family: 'tall', bottles: 5, colors: 3, capacity: 6 },
  { family: 'tall', bottles: 5, colors: 4, capacity: 6 },
  { family: 'tall', bottles: 5, colors: 4, capacity: 8 },
  { family: 'tall', bottles: 5, colors: 4, capacity: 10 },
  // Medium. Tube counts are restricted to multiples of the 5-per-row grid (5/10/15) so every board
  // fills whole rows — 9- or 13-tube boards leave a ragged last row on mobile.
  { family: 'medium', bottles: 10, colors: 7, capacity: 4 },
  { family: 'medium', bottles: 10, colors: 8, capacity: 4 },
  // Large.
  { family: 'large', bottles: 15, colors: 11, capacity: 4 },
  { family: 'large', bottles: 15, colors: 12, capacity: 4 },
];

/**
 * Shapes the live path (plateau tail + endless mode + un-baked fallback) draws from — hard-leaning.
 * Tall tubes are capped at capacity 10 (the baked campaign's max height): capacity-12 tubes get too
 * cramped and can clip or crowd neighbours on small screens, so the live path never serves them.
 */
const LIVE_SHAPES: readonly Shape[] = SHAPES.filter(
  (s) => s.family === 'large' || (s.family === 'tall' && s.capacity >= 8 && s.capacity <= 10),
);

/** Number of levels per chapter. Levels 1..CHAPTER_LEN are chapter 0, etc. */
export const CHAPTER_LEN = 60;

/**
 * Cumulative mechanic sets, indexed by chapter. Chapter 0 is the base game; chapter 1 adds the
 * hidden-colors mechanic. Past the last defined chapter, play plateaus in the final chapter.
 */
const MECHANIC_SETS: readonly (readonly Mechanic[])[] = [
  [], // chapter 0 — base game
  ['hidden'], // chapter 1 — + hidden colors
];

/** Highest chapter we actually have content for. */
export const DEFINED_CHAPTERS = MECHANIC_SETS.length;

/** Total number of campaign levels the offline bake produces (every defined chapter, full length). */
export const CAMPAIGN_LENGTH = DEFINED_CHAPTERS * CHAPTER_LEN;

/** The chapter a level belongs to (clamped to the last defined chapter — the plateau). */
export function chapterForLevel(level: number): number {
  const idx = Math.max(0, Math.floor(level) - 1);
  return Math.min(Math.floor(idx / CHAPTER_LEN), DEFINED_CHAPTERS - 1);
}

/** The mechanics active at a level (its chapter's cumulative set). */
export function mechanicsForLevel(level: number): readonly Mechanic[] {
  return MECHANIC_SETS[chapterForLevel(level)]!;
}

/** Chapter index and within-chapter position (0-based), with plateau clamping past defined chapters. */
function chapterPos(level: number): { chapter: number; pos: number } {
  const idx = Math.max(0, Math.floor(level) - 1);
  const rawChapter = Math.floor(idx / CHAPTER_LEN);
  if (rawChapter >= DEFINED_CHAPTERS) {
    return { chapter: DEFINED_CHAPTERS - 1, pos: CHAPTER_LEN - 1 }; // plateau at the chapter's end
  }
  return { chapter: rawChapter, pos: idx % CHAPTER_LEN };
}

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

/**
 * Offline-bake difficulty curve (consumed by `scripts/build-levels.ts`, not the runtime).
 *
 * Returns where a level should sit on the difficulty curve as a PERCENTILE (0..1) of the chapter's
 * scored candidate pool — a self-calibrating target, so we don't predict absolute difficulty. The
 * curve EASES IN within each chapter (gentle openers) and starts from a HIGHER FLOOR in later
 * chapters, so even the early levels of the hidden chapter are harder than the base chapter's. The
 * three knobs below are the dials (see PLAN.md). Past the last defined chapter the percentile
 * plateaus.
 */
const CURVE = {
  /** Percentile of the very first level (chapter 0, position 0). */
  baseFloor: 0.15,
  /** How much higher each subsequent chapter's floor (and thus its whole curve) sits. */
  chapterFloorStep: 0.12,
  /** How far the percentile climbs from a chapter's start to its end. */
  span: 0.7,
  /** Ease-in exponent: >1 makes the opening levels ramp gently and the back half steeper. */
  easeExp: 1.6,
} as const;

export function targetPercentile(level: number): number {
  const { chapter, pos } = chapterPos(level);
  const t = CHAPTER_LEN <= 1 ? 0 : pos / (CHAPTER_LEN - 1);
  const eased = Math.pow(t, CURVE.easeExp);
  const p = CURVE.baseFloor + chapter * CURVE.chapterFloorStep + eased * CURVE.span;
  return Math.min(1, Math.max(0, p));
}

/**
 * The level's difficulty label — one of three buckets derived from its position on the curve, NOT
 * from tube count (v2). A pure function of the level, so the bake and the live path agree.
 */
export function phaseForLevel(level: number): Difficulty {
  const p = targetPercentile(level);
  if (p < 1 / 3) return 'easy';
  if (p < 2 / 3) return 'normal';
  return 'hard';
}

/** The recipe for generating a level LIVE: a footprint plus chapter/phase, seed, and par knobs. */
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
  /** 2★ ceiling: the adjusted near-optimal band's upper bound (always `> optimal`). See `stars.ts`. */
  twoStarMax: number;
}

/**
 * Recipe for generating a level LIVE (the plateau tail past the baked range, and the safety
 * fallback for any un-baked level). Baked levels do NOT go through this — their board comes straight
 * from `levels.data.ts`. The live path picks a hard-leaning shape (rotated by level for variety),
 * since live levels only occur at/after the plateau where play sits at Hard.
 */
export function planForLevel(level: number): LevelPlan {
  const { chapter, pos } = chapterPos(level);
  const shape = LIVE_SHAPES[Math.max(0, Math.floor(level) - 1) % LIVE_SHAPES.length]!;

  return {
    level,
    chapter,
    phase: phaseForLevel(level),
    colors: shape.colors,
    bottles: shape.bottles,
    capacity: shape.capacity,
    seed: seedForLevel(level),
    minPar: parFloorFor(shape.colors, pos),
    // Exact par only for small, standard-height boards; exact BFS explodes on bigger or taller ones.
    parMode: shape.bottles <= 6 && shape.capacity <= DEFAULT_CAPACITY ? 'optimal' : 'proxy',
    mechanics: MECHANIC_SETS[chapter]!,
  };
}
