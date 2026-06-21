/**
 * The "color-locked funnels" mechanic (chapter 2+). Some tubes are stained a single color and
 * accept ONLY that color: a pour INTO a funnel tube is legal only if the poured color matches the
 * tube's tint (funnels pour OUT normally). This removes the option of parking other colors in those
 * tubes as temporary scratch space — squeezing the buffer flexibility that is the difficulty lever —
 * WITHOUT ever making a board unsolvable.
 *
 * Like {@link ./hidden}, this is a parallel overlay, NOT an engine change: the pure engine stays
 * mechanic-unaware, and the funnel rule is enforced only at the interaction layer (the store) and in
 * the offline solver/metrics, threaded through everywhere as one optional `FunnelGrid` argument
 * (default = no funnels, so chapters 0–1 behave identically).
 *
 * Funnels are STATIC per-tube attributes — a tube's tint never changes mid-game — so, unlike
 * `hidden`'s evolving concealment grid, they add no new search-state dimension; they are purely a
 * move *filter*, which is why threading them through the solver is cheap.
 *
 * Solvability is guaranteed by construction (mirrors `hidden`'s `exposableCells`): funnels are
 * derived from the level's stored full-information solution. A tube is eligible to be funneled only
 * if every solution pour INTO it carries the same color, and it is locked to exactly that color — so
 * the stored solution stays legal under the funnel rule and the board remains provably solvable, with
 * no extra search.
 */
import { legalMoves, topColor } from './engine';
import { mulberry32 } from './rng';
import type { Color, GameState, Move } from './types';

/**
 * A per-tube overlay parallel to a board's bottles: the only color a tube accepts, or `null` for an
 * ordinary (unconstrained) tube.
 */
export type FunnelGrid = readonly (Color | null)[];

/** Fraction of funnel-ELIGIBLE tubes that actually get locked (seeded). Tunable, like `HIDDEN_PROB`. */
export const FUNNEL_PROB = 0.5;

/** An all-null grid shaped to the board (used outside the funnel chapter and for resets). */
export function noFunnels(state: GameState): FunnelGrid {
  return state.bottles.map(() => null);
}

/** Whether any tube is funneled. */
export function anyFunnel(funnels: FunnelGrid): boolean {
  return funnels.some((t) => t != null);
}

/**
 * Whether tube `to` accepts a pour of `color`: an ordinary tube accepts anything; a funnel only its
 * tint. The single rule funnels add — every funnel-aware code path reuses exactly this gate.
 */
export function funnelAccepts(funnels: FunnelGrid | undefined, to: number, color: Color): boolean {
  const tint = funnels?.[to];
  return tint == null || tint === color;
}

/**
 * The legal pours from a state under the funnel rule: `legalMoves` minus any pour the destination
 * funnel rejects. With no funnels it is exactly `legalMoves`, so callers that pass `undefined` behave
 * identically to the un-funneled game.
 */
export function funnelLegalMoves(
  state: GameState,
  funnels?: FunnelGrid,
): Array<{ from: number; to: number }> {
  if (!funnels) return legalMoves(state);
  return legalMoves(state).filter(({ from, to }) =>
    funnelAccepts(funnels, to, topColor(state.bottles[from]!)!),
  );
}

/**
 * The funnel color each tube is ELIGIBLE to be locked to, per the stored solution: a tube is eligible
 * iff it receives at least one pour and EVERY solution pour into it carries the same color (its inflow
 * is monochrome) — that color is returned; otherwise `null`. Locking only eligible tubes to their
 * inflow color is what keeps the stored solution legal, so the board stays solvable (the analogue of
 * {@link ./hidden}'s `exposableCells`).
 */
export function funnelEligibleTubes(state: GameState, solution: Move[]): (Color | null)[] {
  const inflow: (Color | null)[] = state.bottles.map(() => null);
  const conflicted = state.bottles.map(() => false);
  for (const m of solution) {
    if (conflicted[m.to]) continue;
    const seen = inflow[m.to];
    if (seen == null) inflow[m.to] = m.color;
    else if (seen !== m.color) {
      conflicted[m.to] = true;
      inflow[m.to] = null; // mixed inflow — not eligible
    }
  }
  return inflow;
}

/**
 * Choose which tubes start funneled: a seed-driven subset of the eligible tubes, locked to their
 * inflow color. A draw is consumed for EVERY tube so the RNG stream stays aligned regardless of
 * eligibility (mirrors `computeHidden`). The XOR constant differs from `computeHidden`'s so a board's
 * funnel draws are decorrelated from its concealment draws even off the same level seed.
 *
 * The funnel chapter must always SHOW its mechanic, so if the per-tube draw happens to lock nothing
 * we force one eligible tube on (seed-chosen, after the per-tube pass so the aligned draws are
 * unchanged). A board with no eligible tube at all stays unfunneled — it can't be funneled without
 * risking unsolvability — so the bake filters those out of the funnel pool (see build-levels.ts).
 */
export function computeFunnels(state: GameState, seed: number, eligible: (Color | null)[]): FunnelGrid {
  const rng = mulberry32((seed ^ 0x6d2b79f5) >>> 0);
  const grid = state.bottles.map((_, t) => {
    const lock = rng() < FUNNEL_PROB;
    const tint = eligible[t] ?? null;
    return lock ? tint : null;
  });
  if (grid.some((t) => t != null)) return grid;
  const eligibleIdx = eligible.flatMap((c, t) => (c != null ? [t] : []));
  if (eligibleIdx.length === 0) return grid; // nothing we can safely lock
  const pick = eligibleIdx[Math.floor(rng() * eligibleIdx.length)]!;
  grid[pick] = eligible[pick]!;
  return grid;
}

/**
 * Remap funnel tints through a color bijection — the SAME map the board is recolored with each play
 * (see `recolor.ts`). If the funnel ids weren't remapped in lockstep, a recolored board would show
 * mismatched funnel rings.
 */
export function recolorFunnels(funnels: FunnelGrid, map: Record<string, Color>): FunnelGrid {
  return funnels.map((tint) => (tint == null ? null : map[tint] ?? tint));
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
