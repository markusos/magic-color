/**
 * The hint/auto-solve worker: same request/response contract as the retired JS
 * `hintWorker.ts` (Track F5 deleted it), but the A* runs in the Rust core. If the wasm fails
 * to initialize, every request answers `null` ("no hint") — the store already treats that as
 * unavailable.
 */
import {
  initCoreWasm,
  wasmHintMove,
  type HintMove,
  type HintWorkerReply,
  type HintWorkerRequest,
} from './coreWasm';

self.onmessage = (e: MessageEvent<HintWorkerRequest>) => {
  const { id, state, hidden, overlays, maxNodes } = e.data;
  void initCoreWasm().then((ok) => {
    const move: HintMove | null = ok ? wasmHintMove(state, hidden, overlays, maxNodes) : null;
    // Echo the request id so the caller can tell this answer from a superseded solve's.
    (self as unknown as Worker).postMessage({ id, move } satisfies HintWorkerReply);
  });
};
