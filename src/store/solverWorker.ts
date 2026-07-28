/**
 * The shared off-thread solver seam used by BOTH the in-game hint and the admin auto-solve. Owns
 * the single reused hint worker (the Rust core's A* running off the main thread — `coreHintWorker`)
 * and the one primitive both callers need: `solveMove`, which answers the first move of an optimal
 * continuation.
 *
 * Extracted from the game store (H1): the worker lifecycle and the worker-vs-sync fallback lived in
 * two near-identical copies inside `requestHint` and `autoSolve`. This is the single copy.
 */
import {
  wasmHintMove,
  type HintMove,
  type HintRequest,
  type HintWorkerReply,
  type HintWorkerRequest,
} from '../game/coreWasm';

/**
 * How a solve settles. `superseded` means a NEWER solve claimed the shared worker, so no answer is
 * coming for this one — distinct from `move === null`, which is a real verdict ("nothing to
 * suggest"). Callers must unwind on it (drop their in-flight guard, stop their spinner) WITHOUT
 * reporting a result, or they wait forever on a reply that will now be delivered to somebody else.
 */
export type SolveCallback = (move: HintMove | null, superseded?: boolean) => void;

/**
 * Lazily-created, reused worker that runs the hint A* off the main thread (`coreHintWorker` — the
 * Rust core). Created on first solve so boot stays light, and kept alive for subsequent solves.
 * Returns null when the platform has no `Worker` (jsdom/tests) or construction throws, so callers
 * fall back to a synchronous main-thread wasm solve.
 */
let hintWorker: Worker | null = null;
function getHintWorker(): Worker | null {
  if (hintWorker) return hintWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    hintWorker = new Worker(new URL('../game/coreHintWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    hintWorker = null;
  }
  return hintWorker;
}

/** Monotonic request ids, so every reply can be matched to the solve that asked for it. */
let nextId = 1;
/** The solve whose answer is still wanted, or null when the worker is idle. */
let inFlight: { id: number; onResult: SolveCallback } | null = null;

/**
 * Solve the first move of an optimal continuation for `req`, delivering it (or `null` when there's
 * nothing to suggest / the budget was exhausted) to `onResult`.
 *
 * Uses the shared worker off the main thread when one exists — `onResult` then fires on the worker's
 * reply, or on a synchronous main-thread wasm solve if the worker errors. With NO worker
 * (jsdom/tests, or a platform without `Worker`) the wasm solve runs inline and `onResult` fires
 * **synchronously**, before this returns. Callers rely on that synchronous edge: a hint surfaces
 * without awaiting, and the fake-timer auto-solve tests drive the run without flushing microtasks.
 *
 * ONE SOLVE AT A TIME is enforced here rather than assumed of the callers. The two of them do try to
 * stay out of each other's way (a hint cancels any auto-solve run), but cancelling a run does not
 * recall a `postMessage` already sitting in the worker — so a second solve can genuinely start while
 * the first is unanswered. Since the worker is reused and its handlers are overwritten per call, the
 * first reply would otherwise be handed to the second caller: the hint would fire twice (double
 * `recordHint`), or, the other way round, its in-flight guard would never clear and the Hint button
 * would stay dead for the rest of the session. So a new solve SUPERSEDES the old one, whose caller is
 * told (`superseded`) instead of being left waiting, and replies are matched by id.
 */
export function solveMove(req: HintRequest, onResult: SolveCallback): void {
  // Retire whatever was running: its answer is about to be unroutable, so unwind its caller now.
  if (inFlight) {
    const abandoned = inFlight;
    inFlight = null;
    abandoned.onResult(null, true);
  }

  const worker = getHintWorker();
  if (!worker) {
    onResult(wasmHintMove(req.state, req.hidden, req.overlays, req.maxNodes));
    return;
  }

  const id = nextId++;
  inFlight = { id, onResult };
  worker.onmessage = (e: MessageEvent<HintWorkerReply>) => {
    // A superseded solve's answer — its caller has already been unwound, so drop it on the floor.
    if (inFlight?.id !== e.data.id) return;
    inFlight = null;
    onResult(e.data.move);
  };
  // Worker failed to load/run — fall back to a synchronous main-thread wasm solve.
  worker.onerror = () => {
    if (inFlight?.id !== id) return;
    inFlight = null;
    onResult(wasmHintMove(req.state, req.hidden, req.overlays, req.maxNodes));
  };
  worker.postMessage({ ...req, id } satisfies HintWorkerRequest);
}
