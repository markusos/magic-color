/**
 * The "hidden colors" mechanic (chapter 1+) — DISPLAY-SIDE remnants. Some buried segments start
 * concealed (a black band with a "?") and reveal only by surfacing. The RULE (capped pours,
 * reveal-on-surface, finish-blocking) and the solvable-by-construction derivation both live in
 * the Rust core (`core/src/hidden.rs`) and reach the app through the wasm boundary
 * (`coreWasm.ts`): boards arrive with their `HiddenGrid` ready-made, taps return the updated
 * grid, and the per-cell blocked flags are part of every `BoardViewSnapshot`. What remains here
 * is the overlay's type plus the one pure helper the presentation layer needs: an all-visible
 * grid for chapter-0 boards and resets.
 *
 * The underlying GameState always holds the real colors; concealment is a per-cell boolean grid
 * parallel to `GameState.bottles` (bottom-first), kept at the level's INITIAL dimensions.
 */
import type { GameState } from './types';

/**
 * Concealment grid: `hidden[bottle][index]` (bottom-first) — `true` = still concealed. Parallel
 * to `GameState.bottles` at the level's initial shape; a concealed cell never moves while
 * concealed, so its coordinate is stable, and revealing permanently clears its bit.
 */
export type HiddenGrid = boolean[][];

/** An all-visible grid shaped to the board (used for chapter-0 levels and resets). */
export function emptyGrid(state: GameState): HiddenGrid {
  return state.bottles.map((bottle) => bottle.map(() => false));
}
