/**
 * Adapter over the committed Rust core wasm (`core-pkg/`, built by `npm run core:wasm`) — the
 * Track F3 runtime seam. Converts the app's palette-id types to the core's flat byte boundary
 * (color = palette INDEX, `255` = none; boards as `bottles × capacity` cell bytes; concealment
 * as per-tube bitmasks; ice as per-tube `(trigger, height)` pairs) and exposes:
 *
 *   - `wasmHintMove` — drop-in for `search.hintMove`, used by the wasm hint worker;
 *   - `wasmStuck` — the stuck-loop check with the visited set held CORE-SIDE (the F3 design
 *     point resolved per F6: canonical keys never cross the boundary, so the JS
 *     `stateKey`/`canonical` can eventually be deleted);
 *   - `initCoreWasm` — idempotent async init, safe to fire-and-forget on flag enable; every
 *     entry point no-ops (returns the "unavailable" value) until the module is ready, so
 *     callers keep their JS fallback until then.
 *
 * Wasm calls are SYNCHRONOUS once initialized — this module is used on the main thread (stuck
 * checks are microseconds) and inside the wasm hint worker (long solves stay off-thread).
 */
import initWasm, {
  core_version,
  hint,
  rng_sample,
  stuck_check,
  stuck_reset,
  stuck_visit,
  stuck_visited_count,
  initSync,
} from './core-pkg/magic_color_core';
import { PALETTE } from './generator';
import type { HiddenGrid } from './hidden';
import type { Overlays } from './overlays';
import type { HintMove } from './search';
import type { Color, GameState } from './types';

/** The core's "no color" sentinel (see core `types::NO_COLOR`). */
const NO_COLOR = 255;

let ready = false;
let initPromise: Promise<boolean> | null = null;

/**
 * Load + instantiate the wasm module (idempotent; concurrent callers share one attempt).
 * Resolves `false` if the platform can't load it (old browser, blocked fetch) — callers just
 * stay on the JS path.
 */
export function initCoreWasm(): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  initPromise ??= initWasm()
    .then(() => {
      // Boundary self-check: one rng draw must match the shared-vector stream (seed 1).
      const [draw] = rng_sample(1, 1);
      if (draw === undefined) throw new Error('empty rng sample');
      ready = true;
      return true;
    })
    .catch((err: unknown) => {
      console.warn('[core-wasm] init failed — staying on the JS core', err);
      initPromise = null; // allow a later retry (e.g. after a transient network failure)
      return false;
    });
  return initPromise;
}

/** Synchronous init from raw bytes — vitest/Node, where fetch-based init isn't available. */
export function initCoreWasmSync(bytes: BufferSource): void {
  initSync({ module: bytes });
  ready = true;
}

export function coreWasmReady(): boolean {
  return ready;
}

/** Core build version for the diagnostics readout, or null before init. */
export function coreWasmVersion(): string | null {
  return ready ? core_version() : null;
}

const colorIndex = (c: Color): number => {
  const i = PALETTE.indexOf(c);
  if (i < 0) throw new Error(`[core-wasm] unknown color id: ${c}`);
  return i;
};

/** Board → flat cell bytes (bottle-major, bottom-first, NO_COLOR above the fill). */
function encodeCells(state: GameState): Uint8Array {
  const cap = state.capacity;
  const cells = new Uint8Array(state.bottles.length * cap).fill(NO_COLOR);
  state.bottles.forEach((bottle, b) => {
    bottle.forEach((color, i) => {
      cells[b * cap + i] = colorIndex(color);
    });
  });
  return cells;
}

/** Concealment grid → per-tube bitmasks. */
function encodeHidden(hidden: HiddenGrid): Uint16Array {
  return Uint16Array.from(hidden, (col) => col.reduce((acc, h, i) => acc | (h ? 1 << i : 0), 0));
}

/** Funnel grid → per-tube color bytes. */
function encodeFunnels(funnels: Overlays['funnels'], bottles: number): Uint8Array {
  const out = new Uint8Array(bottles).fill(NO_COLOR);
  funnels?.forEach((tint, b) => {
    if (tint != null) out[b] = colorIndex(tint);
  });
  return out;
}

/** Per-cell ice grid → per-tube (trigger, height) pairs (contiguous-bottom invariant). */
function encodeIce(ice: Overlays['ice'], bottles: number): Uint8Array {
  const out = new Uint8Array(bottles * 2).fill(0);
  for (let b = 0; b < bottles; b++) out[b * 2] = NO_COLOR;
  ice?.forEach((col, b) => {
    let height = 0;
    for (let i = 0; i < col.length; i++) if (col[i] != null) height = i + 1;
    if (height > 0) {
      out[b * 2] = colorIndex(col[0]!);
      out[b * 2 + 1] = height;
    }
  });
  return out;
}

/**
 * The first move of an optimal continuation, via the Rust core — same contract as
 * `search.hintMove` (`null` = solved / stuck / budget exhausted / core not ready).
 */
export function wasmHintMove(
  state: GameState,
  hidden: HiddenGrid,
  overlays: Overlays | undefined,
  maxNodes: number,
): HintMove | null {
  if (!ready) return null;
  const n = state.bottles.length;
  const encoded = hint(
    encodeCells(state),
    n,
    state.capacity,
    encodeHidden(hidden),
    encodeFunnels(overlays?.funnels, n),
    encodeIce(overlays?.ice, n),
    maxNodes,
  );
  if (encoded < 0) return null;
  return { from: encoded >> 8, to: encoded & 0xff };
}

/**
 * Core-side stuck-loop detection. Mirrors the store's visited-set lifecycle: `reset` when a
 * board is installed, `visit` after every applied move, `check` when deriving status. All
 * no-ops / non-committal until the wasm is ready — callers keep the JS check as fallback.
 */
export const wasmStuck = {
  reset(state: GameState): void {
    if (ready) stuck_reset(encodeCells(state), state.bottles.length, state.capacity);
  },
  visit(state: GameState): void {
    if (ready) stuck_visit(encodeCells(state), state.bottles.length, state.capacity);
  },
  /** `null` = core not ready (caller should use the JS check instead). */
  check(state: GameState, funnels: Overlays['funnels'], maxNodes: number): boolean | null {
    if (!ready) return null;
    const n = state.bottles.length;
    return stuck_check(encodeCells(state), n, state.capacity, encodeFunnels(funnels, n), maxNodes);
  },
  /** Registry size, for diagnostics/tests. */
  visitedCount(): number {
    return ready ? stuck_visited_count() : 0;
  },
};
