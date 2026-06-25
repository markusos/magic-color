/**
 * Off-main-thread hint solver. The A* in `hintMove` can run for up to `HINT_NODE_BUDGET` nodes on a
 * tangled board — long enough to jank the tap handler — so the store offloads it here. Running it in
 * a worker keeps the main thread free, which is what lets the store's 500 ms timer actually fire (a
 * main-thread `setTimeout` can't run mid-compute) and the hint spinner animate while we wait.
 *
 * Everything crossing the boundary is plain data (boards are `string[][]`, the grids are nested
 * arrays of strings/booleans/null), so structured clone handles it with no custom serialization.
 */
import { hintMove, type HintMove } from './search';
import type { GameState } from './types';
import type { HiddenGrid } from './hidden';
import type { Overlays } from './overlays';

export interface HintRequest {
  state: GameState;
  hidden: HiddenGrid;
  overlays: Overlays;
  maxNodes: number;
}

self.onmessage = (e: MessageEvent<HintRequest>) => {
  const { state, hidden, overlays, maxNodes } = e.data;
  const move: HintMove | null = hintMove(state, hidden, overlays, maxNodes);
  (self as unknown as Worker).postMessage(move);
};
