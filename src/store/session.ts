/**
 * The PURE per-attempt game loop — framework-free, no Zustand, no campaign, no persistence. Given a
 * board, its overlays, and the current selection, it decides the next status and what a tap does. The
 * store ([gameStore.ts](./gameStore.ts)) is a thin adapter: it owns progression/persistence/loading and
 * delegates every *rule* decision here, so this — the most rule-dense, most regression-prone code — is
 * directly unit-testable without standing up the whole app (see `session.test.ts`).
 *
 * Every function is a pure function of its arguments; mechanic rules are consulted through the registry
 * helpers ([mechanics.ts](../game/mechanics.ts)), so a new mechanic needs no change here either.
 */
import { canPour, isWon, pour, topColor } from '../game/engine';
import { isCapped, knownTopRun, revealExposed, type HiddenGrid } from '../game/hidden';
import { cappedColors, frozenCells, type IceGrid } from '../game/ice';
import { acceptsPour, blockedColumns, blocksCompletion, type OverlaySet } from '../game/mechanics';
import { isStuckInLoop } from '../game/solver';
import type { GameState, Move } from '../game/types';
import type { Cue } from '../audio/cues';

export type GameStatus = 'playing' | 'won' | 'deadlocked' | 'stuck';

/**
 * Whether the player has no legal pour. Cap-aware: a capped (finished) tube can't be a source, so its
 * pours don't count as escape moves — the check mirrors exactly what the player can do. A tube whose
 * visible top run is entirely blocked (concealed/frozen) has nothing pourable, so it's not an escape
 * move either. A pour a mechanic rejects (e.g. a funnel mismatch) isn't an escape move.
 */
function noPlayerMove(state: GameState, blocked: HiddenGrid, overlays: OverlaySet): boolean {
  const n = state.bottles.length;
  for (let from = 0; from < n; from++) {
    const src = state.bottles[from]!;
    if (src.length === 0 || isCapped(src, state.capacity, blocked[from])) continue;
    if (knownTopRun(src, blocked[from]) === 0) continue;
    const color = topColor(src)!;
    for (let to = 0; to < n; to++) {
      if (from !== to && canPour(state, from, to) && acceptsPour(overlays, to, color)) return false;
    }
  }
  return true;
}

/**
 * The status of a board: a win, a hard wall (no legal move), a `stuck` loop (moves remain but every
 * reachable board has already been seen — `visited`), or normal play. A board only counts as won once
 * every bottle is sorted AND no mechanic keeps it unfinished (a concealed "?" or a frozen block). The
 * loop check runs full-information, a superset of the player's (cap/conceal-limited) moves, so it can
 * only ever *under*-fire — a player who still has a real move is never told they're stuck.
 */
export function deriveStatus(
  state: GameState,
  overlays: OverlaySet,
  visited: ReadonlySet<string>,
): GameStatus {
  // Every blocking mechanic (concealed "?"s, frozen ice) folded into the columns the run-cap/cap
  // helpers consult (a no-op when the board carries no blocking mechanic).
  const blocked = blockedColumns(overlays, state);
  if (isWon(state)) return blocksCompletion(overlays, state) ? 'playing' : 'won';
  if (noPlayerMove(state, blocked, overlays)) return 'deadlocked';
  if (isStuckInLoop(state, visited, { funnels: overlays.funnels })) return 'stuck';
  return 'playing';
}

/** Whether bottle `b` is a legal pour SOURCE: non-empty, not capped, and with a visible (non-blocked) run. */
function selectable(state: GameState, blocked: HiddenGrid, b: number): boolean {
  const bottle = state.bottles[b];
  return (
    bottle !== undefined &&
    bottle.length > 0 &&
    !isCapped(bottle, state.capacity, blocked[b]) &&
    knownTopRun(bottle, blocked[b]) > 0
  );
}

/**
 * The outcome of tapping bottle `i`, given the current board/overlays/selection — a pure decision the
 * store applies:
 * - `select` — make `i` the selected source (first tap, or reselecting after an illegal pour);
 * - `deselect` — clear the selection (tapped the selected tube again, or an illegal pour onto a
 *   non-selectable tube);
 * - `ignore` — nothing selectable, nothing to do;
 * - `pour` — a legal pour from the selected tube into `i`, capped to the visible run, with the post-pour
 *   board, the move, and the revealed concealment grid.
 */
export type TapPlan =
  | { kind: 'ignore' }
  | { kind: 'select'; selected: number }
  | { kind: 'deselect' }
  | { kind: 'pour'; next: GameState; move: Move; revealedHidden: HiddenGrid };

/** Decide what tapping bottle `i` does. Pure — see {@link TapPlan}. Assumes the board is in play. */
export function planTap(
  state: GameState,
  overlays: OverlaySet,
  selected: number | null,
  i: number,
): TapPlan {
  // Every blocking mechanic folds into the columns the run-cap/cap helpers consult.
  const blocked = blockedColumns(overlays, state);

  // No current selection: select a non-empty, un-capped, pourable bottle.
  if (selected === null) {
    return selectable(state, blocked, i) ? { kind: 'select', selected: i } : { kind: 'ignore' };
  }

  // Tapping the selected bottle again deselects it.
  if (selected === i) return { kind: 'deselect' };

  // Attempt a pour from the selected bottle to the tapped one. Concealed cells block the visible run,
  // so cap the pour at what the player can actually see; a mechanic may reject the destination color.
  if (canPour(state, selected, i) && acceptsPour(overlays, i, topColor(state.bottles[selected]!)!)) {
    const cap = knownTopRun(state.bottles[selected]!, blocked[selected]);
    const { state: next, move } = pour(state, selected, i, cap);
    return { kind: 'pour', next, move, revealedHidden: revealExposed(next, overlays.hidden) };
  }

  // Illegal pour: switch selection to the newly tapped bottle if selectable, else clear it.
  return selectable(state, blocked, i) ? { kind: 'select', selected: i } : { kind: 'deselect' };
}

/** Count of cells currently frozen on a board (0 when there's no ice). */
function frozenCount(state: GameState, hidden: HiddenGrid, ice: IceGrid): number {
  let n = 0;
  for (const col of frozenCells(state, hidden, ice)) for (const f of col) if (f) n++;
  return n;
}

/**
 * The sound/haptic {@link Cue} a tap should fire, or `null` for silence — a PURE classification of the
 * already-decided {@link TapPlan} (plus the resulting status and what the pour accomplished), so the
 * store stays a thin adapter and the mapping is unit-testable without any audio. Drives audio off the
 * existing session decision points rather than component renders (PLAN.md A1).
 *
 * A pour is refined by EFFECT: a win outranks a thaw (a pour can both win and thaw), a thaw outranks a
 * cap (thawing ice is the more delightful event), and a cap outranks a plain pour. A `deselect` caused
 * by an *illegal pour* (the tapped tube isn't the selected one) reads as `invalid`; tapping the
 * selected tube again is an ordinary `deselect`. A no-op `ignore` tap stays silent.
 */
export function cueForTap(
  plan: TapPlan,
  prev: GameState,
  hidden: HiddenGrid,
  ice: IceGrid,
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
      if (frozenCount(plan.next, plan.revealedHidden, ice) < frozenCount(prev, hidden, ice)) return 'thaw';
      const before = cappedColors(prev, hidden, ice).size;
      const after = cappedColors(plan.next, plan.revealedHidden, ice).size;
      return after > before ? 'cap' : 'pour';
    }
  }
}
