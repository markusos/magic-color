/**
 * Core domain types for the color-sort puzzle. This module is pure data — no React,
 * no DOM — so the engine, solver, and generator can be unit-tested in isolation and
 * reused outside the browser (e.g. a future Node backend).
 */

/** A color is referenced by a palette id (see ../theme/colors.ts for CSS values). */
export type Color = string;

/**
 * A bottle is a stack of color segments, bottom-first.
 * Index 0 is the bottom of the bottle, the last index is the top (where pours happen).
 */
export type Bottle = Color[];

/** The full board: a set of bottles plus the shared per-bottle capacity. */
export interface GameState {
  bottles: Bottle[];
  /** Max segments a bottle can hold. Standard water-sort uses 4. */
  capacity: number;
}

/** A single pour from one bottle to another. */
export interface Move {
  from: number;
  to: number;
  /** Number of segments transferred. */
  count: number;
  /** The color that was poured (the top color of `from`). */
  color: Color;
}

/** Difficulty tiers, mirroring the source game's progression. */
export type Difficulty = 'easy' | 'normal' | 'hard';

/** Parameters that define how to generate a level. */
export interface LevelDef {
  colors: number;
  bottles: number;
  capacity: number;
  difficulty: Difficulty;
  /** Optional seed for reproducible generation. */
  seed?: number;
}

/** A concrete, verified-solvable level produced by the generator. */
export interface GeneratedLevel {
  state: GameState;
  colors: number;
  bottles: number;
  capacity: number;
  /** A known sequence of moves that solves the board (proof of solvability). */
  solution: Move[];
  /** Length of the stored solution (an upper bound on the optimal move count). */
  minMoves: number;
  seed: number;
}
