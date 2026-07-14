/**
 * The "color-locked funnels" mechanic (chapter 2+) — DISPLAY-SIDE remnants. Some tubes are
 * stained a single color and accept ONLY that color; the RULE and the derivation both live in
 * the Rust core (`core/src/funnels.rs`) and reach the app through the wasm boundary
 * (`coreWasm.ts`), which supplies each board's `FunnelGrid` ready-made. What remains here is
 * the overlay's type plus the small pure helpers the presentation layer needs: an empty grid
 * for un-funneled chapters, the recolor remap, and the provenance/report load metric.
 */
import type { Color, GameState } from './types';

/**
 * A per-tube overlay parallel to a board's bottles: the only color a tube accepts, or `null` for an
 * ordinary (unconstrained) tube.
 */
export type FunnelGrid = readonly (Color | null)[];

/** An all-null grid shaped to the board (used outside the funnel chapter and for resets). */
export function noFunnels(state: GameState): FunnelGrid {
  return state.bottles.map(() => null);
}

/**
 * Remap funnel tints through a color bijection — the SAME map the board is recolored with each play
 * (see `recolor.ts`). If the funnel ids weren't remapped in lockstep, a recolored board would show
 * mismatched funnel rings.
 */
export function recolorFunnels(funnels: FunnelGrid, map: Record<string, Color>): FunnelGrid {
  return funnels.map((tint) => (tint == null ? null : (map[tint] ?? tint)));
}

/**
 * Funnel difficulty load (0 outside the funnel chapter): the fraction of tubes that are color-locked,
 * normalized by color count. More locked tubes ⇒ less scratch space ⇒ harder. Size-decoupled (a
 * ratio), so it captures the funnel chapter's pressure without just tracking board size.
 */
export function funnelLoad(funnels: FunnelGrid, colors: number): number {
  if (colors <= 0) return 0;
  const locked = funnels.filter((t) => t != null).length;
  return Math.min(1, locked / colors);
}
