/**
 * Difficulty tiers. Each tier has a FIXED number of tubes and a FIXED free-space budget,
 * expressed as a count of spare ("open") tubes. The color count is simply tubes - emptyTubes.
 *
 *   easy:   5 tubes,  1 spare -> 4 colors
 *   normal: 10 tubes, 2 spare -> 8 colors
 *   hard:   15 tubes, 3 spare -> 12 colors (palette max)
 *
 * `emptyTubes` sets how much slack a board carries, not how it looks: the generator scatters
 * that slack as a mix of fully-empty and partially filled tubes, so a level may show anywhere
 * from 0 up to `emptyTubes` completely empty tubes (see randomFillProfile in generator.ts).
 *
 * These were all measured to generate instantly. (Less slack is harder to generate: 1 spare at
 * 15 tubes is effectively impossible, which is why the spare-tube budget scales up.)
 */
import { generateLevel, DEFAULT_CAPACITY } from './generator';
import type { Difficulty, GeneratedLevel, LevelDef } from './types';

interface TierPreset {
  /** Fixed number of tubes for this tier. */
  tubes: number;
  /** Free-space budget, in spare tubes; sets color count and total slack, not literal empties. */
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
