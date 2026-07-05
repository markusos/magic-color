/**
 * The per-attempt game loop, post-F6: a thin TYPED ADAPTER over the Rust core's session
 * surface (`coreWasm.wasmBoardView` / `wasmPlanTap`). Every *rule* decision — status, what a
 * tap does, what blocks a run, what counts as a legal target — is computed core-side; this
 * module only shapes the answers for the store/UI and classifies the audio cue from the facts
 * the core returns. JS holds ZERO rule semantics here (the F6 contract that let the drift
 * gate's G1/G2 retire).
 *
 * The store ([gameStore.ts](./gameStore.ts)) remains the adapter for progression/persistence/
 * loading; components render from {@link viewOf} snapshots instead of consulting rule helpers.
 */
import {
  wasmBoardView,
  wasmPlanTap,
  type BoardViewSnapshot,
  type WasmTapPlan,
} from '../game/coreWasm';
import type { OverlaySet } from '../game/mechanics';
import type { GameState } from '../game/types';
import type { Cue } from '../audio/cues';

export type GameStatus = 'playing' | 'won' | 'deadlocked' | 'stuck';

/** A tap's decided outcome — the core's verdict (see {@link wasmPlanTap}). */
export type TapPlan = WasmTapPlan;

/** Everything the UI renders about one board state — the core's snapshot. */
export type ViewSnapshot = BoardViewSnapshot;

/**
 * The status of a board: a win, a hard wall (no legal move), a `stuck` loop (moves remain but
 * every reachable board has already been visited this attempt — the core-side registry), or
 * normal play. Runs the loop check, so call this when COMMITTING a board, not per render
 * (renders use {@link viewOf}, which skips the check).
 */
export function deriveStatus(state: GameState, overlays: OverlaySet): GameStatus {
  return wasmBoardView(
    state,
    overlays.hidden,
    { funnels: overlays.funnels, ice: overlays.ice },
    null,
    true,
  ).status;
}

/**
 * The render snapshot: per-cell blocked/frozen flags, per-tube selectable/capped/pour-target
 * flags, and the cheap status (loop check skipped — a render must never pay for a search).
 */
export function viewOf(
  state: GameState,
  overlays: OverlaySet,
  selected: number | null,
): ViewSnapshot {
  return wasmBoardView(
    state,
    overlays.hidden,
    { funnels: overlays.funnels, ice: overlays.ice },
    selected,
    false,
  );
}

/** Decide what tapping bottle `i` does. Pure pass-through to the core — see {@link TapPlan}. */
export function planTap(
  state: GameState,
  overlays: OverlaySet,
  selected: number | null,
  i: number,
): TapPlan {
  return wasmPlanTap(
    state,
    overlays.hidden,
    { funnels: overlays.funnels, ice: overlays.ice },
    selected,
    i,
  );
}

/**
 * The sound/haptic {@link Cue} a tap should fire, or `null` for silence — a PURE classification
 * of the already-decided {@link TapPlan}: the core supplies the pour's effect facts (`thawed`,
 * `newlyCapped`), so no board inspection happens here.
 *
 * A pour is refined by EFFECT: a win outranks a thaw (a pour can both win and thaw), a thaw
 * outranks a cap (thawing ice is the more delightful event), and a cap outranks a plain pour.
 * A `deselect` caused by an *illegal pour* (the tapped tube isn't the selected one) reads as
 * `invalid`; tapping the selected tube again is an ordinary `deselect`. A no-op `ignore` tap
 * stays silent.
 */
export function cueForTap(
  plan: TapPlan,
  status: GameStatus,
  selected: number | null,
  i: number,
): Cue | null {
  switch (plan.kind) {
    case 'ignore':
      return null;
    case 'select':
      return 'select';
    case 'deselect':
      return selected !== null && selected !== i ? 'invalid' : 'deselect';
    case 'pour': {
      if (status === 'won') return 'win';
      if (plan.thawed) return 'thaw';
      return plan.newlyCapped ? 'cap' : 'pour';
    }
  }
}
