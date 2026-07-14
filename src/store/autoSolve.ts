/**
 * The admin auto-solve controller (H1 extraction from the game store). Plays the current board to
 * completion by applying the optimal next move every {@link AUTO_SOLVE_DELAY_MS} so the solution is
 * visible move by move. Each move is solved off-thread through the shared solver (with a per-move
 * wall-clock timeout) so a slow board never freezes the page; the win is recorded normally — NOT
 * counted as a hint.
 *
 * Owns all the run state (the generation counter that invalidates a cancelled run, the between-move
 * timer, and the transient-notice timer). The store creates one controller and exposes `start`/`stop`
 * as its `autoSolve` / `cancelAutoSolve` actions, and calls `stop()` from every path that takes over
 * the board (a manual tap, undo, restart, a board load).
 */
import type { GameState } from '../game/types';
import { cueForTap, planTap } from './session';
import { feedback } from '../audio/feedback';
import { solveMove } from './solverWorker';
import type { HintMove } from '../game/coreWasm';
import type { GameStore } from './gameStore';

/**
 * Per-step A* budget for auto-solve (admin-only). Much larger than the hint's — it runs off-thread and
 * is wall-clock-bounded below, and the hardest hidden 15-tube boards need well over a million nodes to
 * surface even a first move. A move that still overflows this stops the run (with the "no move" notice).
 */
const AUTO_SOLVE_NODE_BUDGET = 20_000_000;

/** Delay between auto-solve moves so the solution plays out visibly, move by move. */
const AUTO_SOLVE_DELAY_MS = 500;
/**
 * Wall-clock backstop per move: if the off-thread solve hasn't answered in time, stop the run and show a
 * "timed out" notice. Generous — it runs off-thread with a Stop button, and the hardest concealed boards
 * legitimately need this long to search {@link AUTO_SOLVE_NODE_BUDGET} nodes for a first move.
 */
const AUTO_SOLVE_MOVE_TIMEOUT_MS = 60_000;
/** How long the auto-solve stop notice ("timed out" / "no further moves") stays up before fading. */
const AUTO_SOLVE_NOTICE_MS = 5_000;

export interface AutoSolveDeps {
  get: () => GameStore;
  set: (partial: Partial<GameStore>) => void;
  /** The store's board-commit: applies a new board, derives status, and records a win. */
  commit: (current: GameState, extra: Partial<GameStore>) => void;
}

export interface AutoSolveController {
  /** Play the board to completion, applying the optimal next move every {@link AUTO_SOLVE_DELAY_MS}. */
  start: () => void;
  /** Stop an in-progress run (the "solving…" spinner's Stop control, or any board takeover). */
  stop: () => void;
}

export function createAutoSolve({ get, set, commit }: AutoSolveDeps): AutoSolveController {
  // `gen` is bumped on every start/stop; in-flight worker callbacks and the between-move timer capture
  // the generation they belong to and no-op if it has moved on (so a stale solve from a cancelled run
  // can never apply a move to the current board).
  let gen = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    gen++;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (get().autoSolving) set({ autoSolving: false });
  };

  /** Flash a transient auto-solve stop message, auto-clearing it after {@link AUTO_SOLVE_NOTICE_MS}. */
  const showNotice = (message: string) => {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    set({ autoSolveNotice: message });
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      set({ autoSolveNotice: null });
    }, AUTO_SOLVE_NOTICE_MS);
  };

  const start = () => {
    stop(); // cancel any prior run and take a fresh generation
    if (get().status !== 'playing') return;
    const runGen = gen;
    const nonce = get().boardNonce;
    const startedAt = performance.now();
    let applied = 0; // moves applied so far this run (for the summary / logs)
    set({ autoSolving: true, autoSolveNotice: null, selected: null, hint: null });
    console.info(`[auto-solve] start — ${get().mode} L${get().level}`);

    // Whether this run is still the active one AND the same board is in play.
    const live = () => runGen === gen && get().boardNonce === nonce && get().status === 'playing';
    const finishRun = () => {
      if (runGen !== gen) return; // a newer run/stop already owns the state
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      set({ autoSolving: false });
    };
    // Stop the run early (timed out / no move) with a transient on-screen notice.
    const halt = (message: string) => {
      finishRun();
      showNotice(message);
      feedback('invalid');
      console.warn(`[auto-solve] stopped after ${applied} move(s): ${message}`);
    };

    // Apply one solved move (planTap keeps it legal under the overlays), then schedule the next.
    const apply = (from: number, to: number) => {
      const { current, hidden, ice } = get();
      const plan = planTap(current, { hidden, funnels: get().funnels, ice }, from, to);
      if (plan.kind !== 'pour') {
        halt('No further moves');
        return;
      }
      commit(plan.next, {
        history: [...get().history, current],
        hiddenHistory: [...get().hiddenHistory, hidden],
        hidden: plan.revealedHidden,
        moves: [...get().moves, plan.move],
        selected: null,
        hint: null,
      });
      applied++;
      // Play the move's natural cue — including the win chime on the final move.
      const cue = cueForTap(plan, get().status, from, to);
      if (cue) feedback(cue, plan.next.bottles[plan.move.to]!.length / plan.next.capacity);
      if (get().status === 'won') {
        finishRun();
        console.info(
          `[auto-solve] solved in ${applied} moves (${Math.round(performance.now() - startedAt)}ms)`,
        );
      } else if (get().status === 'playing') {
        timer = setTimeout(step, AUTO_SOLVE_DELAY_MS);
      } else {
        halt(`Board ${get().status}`); // stuck/deadlocked — shouldn't happen on an optimal line
      }
    };

    // Solve the next move OFF-THREAD (like a hint) so a slow board never janks the page; a wall-clock
    // timeout backstops a hung solve. Falls back to a synchronous solve when there's no worker (tests).
    const step = () => {
      timer = null;
      if (!live()) {
        finishRun();
        return;
      }
      const { current, hidden, funnels, ice } = get();
      const overlays = { funnels, ice };
      const t0 = performance.now();
      let settled = false;
      const done = (move: HintMove | null, timedOut = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!live()) {
          finishRun();
          return;
        }
        if (!move) {
          halt(timedOut ? 'Solver timed out' : 'No further moves');
          return;
        }
        // Per-move timing at debug level, so the default console stays minimal (start/end only).
        console.debug(
          `[auto-solve] #${applied + 1} ${move.from}→${move.to} (${Math.round(performance.now() - t0)}ms)`,
        );
        apply(move.from, move.to);
      };
      const timeout = setTimeout(() => done(null, true), AUTO_SOLVE_MOVE_TIMEOUT_MS);
      solveMove({ state: current, hidden, overlays, maxNodes: AUTO_SOLVE_NODE_BUDGET }, (move) => done(move));
    };

    step(); // first move computed immediately; the rest follow every AUTO_SOLVE_DELAY_MS
  };

  return { start, stop };
}
