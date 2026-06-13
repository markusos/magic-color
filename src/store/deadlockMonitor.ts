/**
 * Debounced, off-main-thread deadlock detection. The store schedules an unsolvability
 * check after each move; the monitor coalesces rapid moves (debounce) and runs the check
 * in a Web Worker so the UI never janks. Results that arrive after a newer move are
 * discarded, so a stale "you're stuck" can never override a live board.
 *
 * In environments without `Worker` (Node, tests) it transparently falls back to running
 * the check in-process, so callers don't need to special-case anything.
 */
import { isUnsolvable } from '../game/solver';
import type { GameState } from '../game/types';
import type { DeadlockRequest, DeadlockResponse } from '../game/solver.worker';

/** Resolves to `true` when the board is provably unwinnable. */
export type UnsolvableCheck = (state: GameState) => Promise<boolean>;

export interface DeadlockMonitor {
  /** Schedule a debounced check; `onResult` runs only if no newer schedule supersedes it. */
  schedule(state: GameState, onResult: (unsolvable: boolean) => void): void;
  /** Invalidate any pending or in-flight check without running its callback. */
  cancel(): void;
  /** Tear down the monitor (and its worker). */
  dispose(): void;
}

export interface MonitorConfig {
  debounceMs?: number;
  /** Override the unsolvability check — tests inject a synchronous one. */
  check?: UnsolvableCheck;
}

/** Build a worker-backed check, or `null` if Workers aren't available here. */
function createWorkerCheck(): UnsolvableCheck | null {
  if (typeof Worker === 'undefined') return null;

  let worker: Worker;
  try {
    worker = new Worker(new URL('../game/solver.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }

  let nextId = 0;
  const pending = new Map<number, (unsolvable: boolean) => void>();

  worker.addEventListener('message', (event: MessageEvent<DeadlockResponse>) => {
    const resolve = pending.get(event.data.id);
    if (resolve) {
      pending.delete(event.data.id);
      resolve(event.data.unsolvable);
    }
  });

  return (state) =>
    new Promise<boolean>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      const request: DeadlockRequest = { id, state };
      worker.postMessage(request);
    });
}

/** Synchronous fallback for Node/tests, or browsers without Worker support. */
const inProcessCheck: UnsolvableCheck = (state) => Promise.resolve(isUnsolvable(state));

export function createDeadlockMonitor(config: MonitorConfig = {}): DeadlockMonitor {
  const debounceMs = config.debounceMs ?? 250;
  const check = config.check ?? createWorkerCheck() ?? inProcessCheck;

  let timer: ReturnType<typeof setTimeout> | null = null;
  // Bumped on every schedule/cancel; a resolved check only fires its callback if its run
  // is still the latest. This drops both debounced-away and in-flight stale results.
  let runId = 0;

  return {
    schedule(state, onResult) {
      runId += 1;
      const myRun = runId;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        check(state).then((unsolvable) => {
          if (myRun === runId) onResult(unsolvable);
        });
      }, debounceMs);
    },

    cancel() {
      runId += 1;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },

    dispose() {
      this.cancel();
    },
  };
}
