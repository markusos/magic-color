/**
 * Difficulty tiers. Each tier has a FIXED number of tubes and a FIXED number of empty
 * ("open") tubes; the remaining tubes each start full of one color, so the color count is
 * simply tubes - emptyTubes.
 *
 *   easy:   5 tubes,  1 open -> 4 colors
 *   normal: 10 tubes, 2 open -> 8 colors
 *   hard:   15 tubes, 3 open -> 12 colors (palette max)
 *
 * These were all measured to generate instantly. (Fewer open tubes is harder to generate:
 * 1 open at 15 tubes is effectively impossible, which is why open-tube counts scale up.)
 */
import { generateLevel, DEFAULT_CAPACITY } from './generator';
import type { Difficulty, GeneratedLevel, LevelDef } from './types';

interface TierPreset {
  /** Fixed number of tubes for this tier. */
  tubes: number;
  /** Fixed number of empty ("open") tubes; the rest each hold one color. */
  emptyTubes: number;
}

export const TIERS: Record<Difficulty, TierPreset> = {
  easy: { tubes: 5, emptyTubes: 1 },
  normal: { tubes: 10, emptyTubes: 2 },
  hard: { tubes: 15, emptyTubes: 3 },
};

/** Resolve an explicit or random seed to a concrete number. */
function resolveSeed(seed?: number): number {
  return seed ?? ((Math.random() * 2 ** 32) >>> 0);
}

/** Build a LevelDef from a difficulty tier. Color count = tubes - open tubes. */
export function levelDefForTier(difficulty: Difficulty, seed?: number): LevelDef {
  const preset = TIERS[difficulty];
  return {
    colors: preset.tubes - preset.emptyTubes,
    bottles: preset.tubes,
    capacity: DEFAULT_CAPACITY,
    difficulty,
    seed: resolveSeed(seed),
  };
}

/** Generate a concrete, solvable level for a difficulty tier. */
export function createLevel(difficulty: Difficulty, seed?: number): GeneratedLevel {
  const def = levelDefForTier(difficulty, seed);
  return generateLevel({
    colors: def.colors,
    bottles: def.bottles,
    capacity: def.capacity,
    seed: def.seed,
  });
}

/** A few fixed-seed starter levels so the first play session is consistent. */
export const STARTER_SEEDS: Record<Difficulty, number> = {
  easy: 1,
  normal: 2,
  hard: 3,
};
