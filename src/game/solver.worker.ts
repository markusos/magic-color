/// <reference lib="webworker" />
/**
 * Web Worker that runs the (potentially expensive) exhaustive unsolvability check off the
 * main thread, so proving a "stuck loop" never blocks rendering or input. Each request
 * carries an `id` the main thread uses to correlate the matching response.
 */
import { isUnsolvable } from './solver';
import type { GameState } from './types';

export interface DeadlockRequest {
  id: number;
  state: GameState;
}

export interface DeadlockResponse {
  id: number;
  unsolvable: boolean;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<DeadlockRequest>) => {
  const { id, state } = event.data;
  const response: DeadlockResponse = { id, unsolvable: isUnsolvable(state) };
  ctx.postMessage(response);
});
