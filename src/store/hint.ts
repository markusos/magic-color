/**
 * The in-game hint controller (H1 extraction from the game store). Owns the on-demand hint flow:
 * kick the shared off-thread solver, drive the button's delayed spinner, then either pulse the
 * suggested pour (and mark the attempt as hinted) or pop the transient "no hint" notice.
 *
 * The store wires this in and exposes `request`/`dismissUnavailable` as its `requestHint` /
 * `dismissHintUnavailable` actions; all the mutable orchestration state (the in-flight guard, the
 * spinner timer) lives here rather than in the store closure.
 */
import type { HintMove } from '../game/coreWasm';
import { feedback } from '../audio/feedback';
import { solveMove } from './solverWorker';
import type { GameStore } from './gameStore';

/**
 * Node budget for the on-demand hint A*. The search runs in a worker (see `solverWorker`), so a long
 * solve no longer janks the tap handler — the cap only bounds how long the spinner can spin. Set high
 * enough that a hard-but-solvable board (e.g. a 15-tube, heavily-iced level whose ~50-move optimum
 * needs ~500k nodes to surface even a first move) yields a real hint instead of a false "no hint";
 * still bounded so a genuinely deadlocked board returns "no hint" in a few seconds rather than hanging.
 */
const HINT_NODE_BUDGET = 1_000_000;

/** Wait this long before showing the hint spinner — a fast solve resolves first and never flashes it. */
const HINT_SPINNER_DELAY_MS = 500;

export interface HintDeps {
  get: () => GameStore;
  set: (partial: Partial<GameStore>) => void;
  /** Tally one hint taken into the persisted lifetime count (campaign.recordHint). */
  recordHint: () => void;
  /** Cancel any in-progress auto-solve — a hint and an auto-solve must not fight over the worker. */
  stopAutoSolve: () => void;
}

export interface HintController {
  /**
   * Surface one optimal next pour for the current board and pulse those two tubes. Computed lazily on
   * demand (no solver kept running). A no-op when the board isn't in play; on a won/stuck board there's
   * no move to show, so it just fires the muted "invalid" cue.
   */
  request: () => void;
  /** Dismiss the transient "No hint available" popover early (the UI also auto-fades it after 2s). */
  dismissUnavailable: () => void;
}

export function createHint({ get, set, recordHint, stopAutoSolve }: HintDeps): HintController {
  // True while a hint solve is in flight — guards against a double-tap kicking off a second worker
  // round-trip (and a duplicate `recordHint`) before the first answers.
  let pending = false;

  const request = () => {
    stopAutoSolve(); // don't let a hint and an auto-solve run fight over the shared worker
    const { current, hidden, funnels, ice, status } = get();
    // Ignore re-taps while a hint is already in flight, and only hint a live board.
    if (status !== 'playing' || pending) return;
    pending = true;
    // Clear any lingering "no hint" popover from a previous press.
    set({ hintUnavailable: false });

    const overlays = { funnels, ice };

    // Show the spinner only if the solve is slow (>500 ms). The timer can fire because the heavy
    // work runs off-thread in the worker; a fast hint resolves first and cancels it, so the button
    // never flickers a spinner for the common instant case.
    let spinnerTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      spinnerTimer = null;
      set({ hintLoading: true });
    }, HINT_SPINNER_DELAY_MS);

    // Settle one request: stop the spinner timer, then either pulse the move or pop the
    // "no hint" notice. Optimal *from the current board* (after any undos / partial solve) under the
    // live overlays — not necessarily the baked solution's next move.
    const finish = (move: HintMove | null) => {
      pending = false;
      if (spinnerTimer) {
        clearTimeout(spinnerTimer);
        spinnerTimer = null;
      }
      if (move) {
        // Taking a hint caps this attempt's rating to 1 star (see `hintUsed`) and adds to the
        // persisted lifetime hint tally surfaced on the stats screen.
        recordHint();
        set({ hint: move, selected: null, hintUsed: true, hintLoading: false });
        feedback('select');
      } else {
        // Won is filtered out above; stuck/budget-exhausted → no continuation to offer. Flag the
        // transient popover (the UI fades it out after 2s) and nudge toward Undo/Restart.
        set({ hintLoading: false, hintUnavailable: true });
        feedback('invalid');
      }
    };

    solveMove({ state: current, hidden, overlays, maxNodes: HINT_NODE_BUDGET }, finish);
  };

  const dismissUnavailable = () => {
    if (get().hintUnavailable) set({ hintUnavailable: false });
  };

  return { request, dismissUnavailable };
}
