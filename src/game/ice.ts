/**
 * The "frozen tubes" mechanic (chapter 3+) — DISPLAY-SIDE remnants. A tube can start with its
 * bottom region encased in a block of ice, tinted one **trigger color**, thawing all at once when
 * that color is capped. The RULE (blocking, thaw cascades, derived frozen state) and the
 * solvable-by-construction derivation both live in the Rust core (`core/src/ice.rs`) and reach
 * the app through the wasm boundary (`coreWasm.ts`): boards arrive with their `IceGrid`
 * ready-made, and the per-cell frozen flags are part of every `BoardViewSnapshot`. What remains
 * here is the overlay's type plus the small pure helpers the presentation layer needs: an empty
 * grid for un-iced chapters, the recolor remap, and the provenance/report load metric.
 */
import type { Color, GameState } from './types';

/**
 * A per-cell overlay parallel to a board's bottles (bottom-first): the trigger color tinting a frozen
 * cell, or `null` for an ordinary cell. Maintains a contiguous-bottom invariant — within a tube, the
 * non-null cells form an unbroken block from index 0 up to the ice line, all the same color.
 */
export type IceGrid = readonly (readonly (Color | null)[])[];

/** An all-clear grid shaped to the board (used outside the ice chapter and for resets). */
export function noIce(state: GameState): IceGrid {
  return state.bottles.map((bottle) => bottle.map(() => null));
}

/**
 * Remap ice tints through a color bijection — the SAME map the board is recolored with each play (see
 * `recolor.ts`). Without lockstep remapping, a recolored board would show ice tinted a color the liquid
 * no longer uses.
 */
export function recolorIce(ice: IceGrid, map: Record<string, Color>): IceGrid {
  return ice.map((col) => col.map((tint) => (tint == null ? null : map[tint] ?? tint)));
}

/**
 * Ice difficulty load (0 outside the ice chapter): the fraction of segments that start frozen. More
 * frozen volume ⇒ more of the board locked behind a completion order ⇒ harder. Size-decoupled (a
 * ratio) so it captures the chapter's pressure without just tracking board size.
 */
export function iceLoad(ice: IceGrid): number {
  let iced = 0;
  let total = 0;
  for (const col of ice) {
    for (const tint of col) {
      total++;
      if (tint != null) iced++;
    }
  }
  return total === 0 ? 0 : iced / total;
}
