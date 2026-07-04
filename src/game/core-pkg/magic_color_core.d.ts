/* tslint:disable */
/* eslint-disable */

/**
 * Core build version, for the diagnostics readout (E9/F5: "show core: wasm/js").
 */
export function core_version(): string;

/**
 * First move of an optimal continuation (the in-game hint / auto-solve step), or `-1` when
 * there is nothing to suggest (solved, stuck, or node budget exhausted). Encoded as
 * `(from << 8) | to` — bottle counts are ≤ 15, so a byte each is generous.
 */
export function hint(cells: Uint8Array, bottles: number, capacity: number, hidden: Uint16Array, funnels: Uint8Array, ice_pairs: Uint8Array, max_nodes: number): number;

/**
 * First `n` draws of `mulberry32(seed)` — the F0 boundary smoke test, kept as a cheap
 * self-check the adapter can assert at init.
 */
export function rng_sample(seed: number, n: number): Float64Array;

/**
 * Whether the player is provably circling (every reachable state already visited this
 * attempt) — the core-side `isStuckInLoop`, same conservative semantics (budget-inconclusive
 * ⇒ false).
 */
export function stuck_check(cells: Uint8Array, bottles: number, capacity: number, funnels: Uint8Array, max_nodes: number): boolean;

/**
 * Start a fresh attempt: clear the registry and record the initial board.
 */
export function stuck_reset(cells: Uint8Array, bottles: number, capacity: number): void;

/**
 * Record a reached board (call after every applied move — including undo targets, which are
 * already present from their first visit).
 */
export function stuck_visit(cells: Uint8Array, bottles: number, capacity: number): void;

/**
 * Registry size — for the E9 diagnostics readout and adapter tests.
 */
export function stuck_visited_count(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly core_version: () => [number, number];
    readonly hint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly rng_sample: (a: number, b: number) => [number, number];
    readonly stuck_check: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly stuck_reset: (a: number, b: number, c: number, d: number) => void;
    readonly stuck_visit: (a: number, b: number, c: number, d: number) => void;
    readonly stuck_visited_count: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
