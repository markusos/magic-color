/**
 * Difficulty tiers and a small catalog of starter levels. Tiers map the source game's
 * Normal / Hard / Super-Hard onto generator parameters (more colors, fewer empties).
 */
import { generateLevel, DEFAULT_CAPACITY } from './generator';
import type { Difficulty, GeneratedLevel, LevelDef } from './types';

interface TierPreset {
  colors: number;
  /** Number of empty bottles to add on top of the color bottles. */
  empties: number;
}

export const TIERS: Record<Difficulty, TierPreset> = {
  normal: { colors: 4, empties: 2 },
  hard: { colors: 7, empties: 2 },
  superHard: { colors: 10, empties: 1 },
};

/** Build a LevelDef from a difficulty tier (and optional seed). */
export function levelDefForTier(difficulty: Difficulty, seed?: number): LevelDef {
  const preset = TIERS[difficulty];
  return {
    colors: preset.colors,
    bottles: preset.colors + preset.empties,
    capacity: DEFAULT_CAPACITY,
    difficulty,
    seed,
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
  normal: 1,
  hard: 2,
  superHard: 3,
};
