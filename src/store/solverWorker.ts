/**
 * The shared off-thread solver seam used by BOTH the in-game hint and the admin auto-solve. Owns
 * the single reused hint worker (the Rust core's A* running off the main thread — `coreHintWorker`)
 * and the one primitive both callers need: `solveMove`, which answers the first move of an optimal
 * continuation.
 *
 * Extracted from the game store (H1): the worker lifecycle and the worker-vs-sync fallback lived in
 * two near-identical copies inside `requestHint` and `autoSolve`. This is the single copy.
 */
import { wasmHintMove, type HintMove, type HintRequest } from '../game/coreWasm';

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
 * Only one solve is ever in flight at a time (the store gates hint re-taps and cancels any auto-solve
 * before starting another), so sharing one worker — whose handlers each call overwrites — is safe.
 */
export function solveMove(req: HintRequest, onResult: (move: HintMove | null) => void): void {
  const worker = getHintWorker();
  if (worker) {
    worker.onmessage = (e: MessageEvent<HintMove | null>) => onResult(e.data);
    // Worker failed to load/run — fall back to a synchronous main-thread wasm solve.
    worker.onerror = () => onResult(wasmHintMove(req.state, req.hidden, req.overlays, req.maxNodes));
    worker.postMessage(req);
  } else {
    onResult(wasmHintMove(req.state, req.hidden, req.overlays, req.maxNodes));
  }
}
