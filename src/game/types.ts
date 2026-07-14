/**
 * Core domain types for the color-sort puzzle. This module is pure data — no React,
 * no DOM — so the engine, solver, and generator can be unit-tested in isolation and
 * reused outside the browser (e.g. a future Node backend).
 */

/**
 * A color is referenced by a palette id (see ../theme/colors.ts for CSS values). It's a
 * *branded* string: every color originates from the palette or a recolor remap, so a raw,
 * unrelated string (a state-key hash, a CSS value, a level id) can't be passed where a color is
 * expected. The brand exists only at the type level — at runtime a Color is just its id string.
 */
export type Color = string & { readonly __color: unique symbol };

/**
 * The audited boundary where an *external* raw string (deserialized baked data, a test fixture)
 * becomes a branded {@link Color}, instead of scattering `as Color` casts across those call sites.
 * (The in-code origin is the `PALETTE` literal in `palette.ts` — one definition, one cast; every
 * other color is a remap of those ids, so this and `PALETTE` are the brand's only trust points.) The
 * brand is purely compile-time, so this is a no-op at runtime.
 */
export function toColor(id: string): Color {
  return id as Color;
}

/** {@link toColor} over a list — e.g. deserializing a baked bottle of raw palette ids. */
export function toColors(ids: readonly string[]): Color[] {
  return ids.map(toColor);
}

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

/**
 * Difficulty phase. In the single linear campaign this is a *label* derived from the
 * level number (which rung of the footprint ladder you're on), not a mode the player picks.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Bucket a curve percentile (0..1) into its difficulty label — the shared thirds split behind both
 * the campaign's `phaseForLevel` and the load path's `phaseForTarget`. Pure and bake-irrelevant, so
 * it lives here with the domain types rather than being copied into either module.
 */
export function difficultyForPercentile(p: number): Difficulty {
  if (p < 1 / 3) return 'easy';
  if (p < 2 / 3) return 'normal';
  return 'hard';
}

/**
 * Optional board mechanics layered on by later chapters (cumulative). Empty in chapter 0
 * (the base game); `hidden` (covered segments) is chapter 1; `funnel` (color-locked tubes) is
 * chapter 2; `ice` (frozen tubes that thaw when a trigger color is capped) is chapter 3.
 */
export type Mechanic = 'hidden' | 'funnel' | 'ice';

/**
 * How a level's "par" is measured. `optimal` runs the exact (but heavier) BFS — used for the
 * small Easy/Normal boards; `proxy` uses the DFS solution length — cheap, used for big Hard
 * boards where exact BFS risks the node cap.
 */
export type ParMode = 'optimal' | 'proxy';

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
  /**
   * The level's "par" — the difficulty signal shown to the player and used by the
   * generator's par-floor rejection. Equals the exact optimal (ParMode `optimal`) or the
   * DFS solution length (ParMode `proxy`). Without a par target it's just `minMoves`.
   */
  par: number;
  seed: number;
}
