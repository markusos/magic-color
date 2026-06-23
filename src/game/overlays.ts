/**
 * The STATIC, per-board mechanic overlays, bundled into one value that threads through the solver,
 * the capped search, and the difficulty metrics. Each is a grid parallel to the board's bottles that
 * the pure engine never sees: `funnels` (chapter 2 — per-tube color locks) and `ice` (chapter 3 —
 * per-cell frozen blocks tinted by a trigger color).
 *
 * Why a bundle: these mechanics are STATIC for a whole attempt — a move filter (`funnels`) or a
 * derived-block rule (`ice`), never evolving search state (that's `hidden`, which is carried per
 * node). Threading them as ONE `Overlays` argument — instead of a trailing positional per mechanic —
 * means a future static mechanic adds a FIELD here rather than an argument to every search/metric
 * signature (see PLAN.md R1/R2). This is the seam the planned `MechanicModule` registry will plug
 * into.
 *
 * Every field is optional and defaults to "absent" ⇒ the un-mechanic'd game, so a chapter that
 * doesn't use a mechanic behaves byte-identically (the basis for re-bakes reproducing earlier
 * chapters exactly).
 *
 * Note the two consumer scopes differ in what they read: the full-information solver (`solver.ts`)
 * consults only `funnels` (it is deliberately not ice-aware — see PLAN.md / the `ice-mechanic` memo),
 * while the capped search (`search.ts`) and the offline metrics (`difficulty.ts`) honor both. Each
 * consumer simply reads the field(s) it understands; a superset bundle is harmless to the rest.
 */
import type { FunnelGrid } from './funnels';
import type { IceGrid } from './ice';

export interface Overlays {
  /** Per-tube color locks (chapter 2+). Absent ⇒ no funnels, i.e. the un-funneled game. */
  funnels?: FunnelGrid;
  /** Per-cell frozen-block trigger tints (chapter 3+). Absent ⇒ no ice. */
  ice?: IceGrid;
}
