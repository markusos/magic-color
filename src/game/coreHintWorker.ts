/**
 * The hint/auto-solve worker: same request/response contract as the retired JS
 * `hintWorker.ts` (Track F5 deleted it), but the A* runs in the Rust core. If the wasm fails
 * to initialize, every request answers `null` ("no hint") — the store already treats that as
 * unavailable.
 */
import { initCoreWasm, wasmHintMove, type HintMove, type HintRequest } from './coreWasm';

self.onmessage = (e: MessageEvent<HintRequest>) => {
  const { state, hidden, overlays, maxNodes } = e.data;
  void initCoreWasm().then((ok) => {
    const move: HintMove | null = ok ? wasmHintMove(state, hidden, overlays, maxNodes) : null;
    (self as unknown as Worker).postMessage(move);
  });
};
