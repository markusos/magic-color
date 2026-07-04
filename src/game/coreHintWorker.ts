/**
 * The wasm twin of `hintWorker.ts` (Track F3): same request/response contract, but the A*
 * runs in the Rust core. The store picks this worker when the admin "WASM core" flag is on;
 * both workers coexist so the flag can A/B them on-device. If the wasm fails to initialize,
 * every request answers `null` ("no hint") — the store already treats that as unavailable.
 */
import { initCoreWasm, wasmHintMove } from './coreWasm';
import type { HintRequest } from './hintWorker';
import type { HintMove } from './search';

self.onmessage = (e: MessageEvent<HintRequest>) => {
  const { state, hidden, overlays, maxNodes } = e.data;
  void initCoreWasm().then((ok) => {
    const move: HintMove | null = ok ? wasmHintMove(state, hidden, overlays, maxNodes) : null;
    (self as unknown as Worker).postMessage(move);
  });
};
