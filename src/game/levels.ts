/**
 * Difficulty tiers. Each tier has a FIXED number of tubes (5 / 10 / 15) and a range of
 * color counts; the actual color count for a level is picked from that range per-seed,
 * so the number of colors stays flexible between levels while the tube count is constant.
 *
 * Empties drive both difficulty and generation cost. Measured limits: 1 empty is fine on
 * a 5-tube board but churns at 10 tubes and is *impossible* at 15 (every shuffle is
 * unsolvable); 2 empties is fast everywhere. So the floor scales with size — easy may run
 * to 1 empty, hard stays >= 2, super uses 3 (which also pins it to the 12-color palette).
 */
import { generateLevel, mulberry32, DEFAULT_CAPACITY } from './generator';
import type { Difficulty, GeneratedLevel, LevelDef } from './types';

interface TierPreset {
  /** Fixed number of tubes for this tier. */
  tubes: number;
  /** Inclusive range the per-level color count is drawn from. */
  colorsMin: number;
  colorsMax: number;
}

export const TIERS: Record<Difficulty, TierPreset> = {
  easy: { tubes: 5, colorsMin: 3, colorsMax: 4 }, // 1–2 empties
  normal: { tubes: 10, colorsMin: 7, colorsMax: 8 }, // 2–3 empties
  // Pinned at 12 (= palette max): 15 tubes with <= 3 empties forces 12+ colors, and the
  // palette tops out at 12, so the hardest tier is a fixed 12 colors / 3 empties.
  hard: { tubes: 15, colorsMin: 12, colorsMax: 12 },
};

/** Deterministically pick a color count in the tier's range from a seed. */
function colorsForSeed(preset: TierPreset, seed: number): number {
  const span = preset.colorsMax - preset.colorsMin + 1;
  // XOR the seed into a separate PRNG stream so the color choice doesn't correlate with
  // the board shuffle (which uses the raw seed inside generateLevel).
  const pick = mulberry32(seed ^ 0x9e3779b9)();
  return preset.colorsMin + Math.floor(pick * span);
}

/** Resolve an explicit or random seed to a concrete number. */
function resolveSeed(seed?: number): number {
  return seed ?? ((Math.random() * 2 ** 32) >>> 0);
}

/** Build a LevelDef from a difficulty tier, with the per-seed color count resolved. */
export function levelDefForTier(difficulty: Difficulty, seed?: number): LevelDef {
  const preset = TIERS[difficulty];
  const resolved = resolveSeed(seed);
  return {
    colors: colorsForSeed(preset, resolved),
    bottles: preset.tubes,
    capacity: DEFAULT_CAPACITY,
    difficulty,
    seed: resolved,
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
