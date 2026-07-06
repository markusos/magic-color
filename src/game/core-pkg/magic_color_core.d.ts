/* tslint:disable */
/* eslint-disable */

/**
 * A decoded board + its overlays — the boundary handle for the per-action gameplay calls
 * (F6). The JS adapter constructs one from the flat arrays (decode happens ONCE, in the
 * constructor), calls the cohesive `hint`/`view`/`tap`/`force_pour` methods, then frees it.
 * This replaced four free functions that each repeated the same 6-arg board+overlay prefix.
 */
export class Board {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The free-pour debug cheat (F6): engine-geometry-only move, mechanics ignored. Returns a
     * pour-kind TapResult, or ignore-kind when nothing can move.
     */
    force_pour(from: number, to: number): TapResult;
    /**
     * First move of an optimal continuation (the in-game hint / auto-solve step), or `-1` when
     * there is nothing to suggest (solved, stuck, or node budget exhausted). Encoded as
     * `(from << 8) | to` — bottle counts are ≤ 15, so a byte each is generous.
     */
    hint(max_nodes: number): number;
    constructor(cells: Uint8Array, bottles: number, capacity: number, hidden: Uint16Array, funnels: Uint8Array, ice_pairs: Uint8Array);
    /**
     * Decide what tapping tube `i` does (F6) — the core-side `planTap`.
     */
    tap(selected: number, i: number): TapResult;
    /**
     * The board snapshot (F6): status + per-tube masks/flags the UI renders and gates on.
     * `selected` is `-1` for none; `stuck_max_nodes` bounds the loop check (which runs only
     * when the board is otherwise in play — pass 0 on render paths to skip it entirely).
     */
    view(selected: number, stuck_max_nodes: number): BoardView;
}

/**
 * Flat `View` for the boundary: per-tube masks/flags + the status byte
 * (0 playing / 1 won / 2 deadlocked / 3 stuck).
 */
export class BoardView {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    blocked: Uint16Array;
    capped: Uint8Array;
    frozen: Uint16Array;
    pour_targets: Uint8Array;
    selectable: Uint8Array;
    status: number;
}

/**
 * A chosen live board, flat-encoded for the boundary. Vec fields are exposed through
 * `getter_with_clone` (one copy per level load — negligible).
 */
export class LiveLevel {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    bottles: number;
    capacity: number;
    cells: Uint8Array;
    funnels: Uint8Array;
    hidden: Uint16Array;
    /**
     * `(trigger, height)` per tube.
     */
    ice_pairs: Uint8Array;
    m_colors: number;
    m_dead_end_density: number;
    m_dig_depth: number;
    m_empties: number;
    m_forced_move_ratio: number;
    m_funnel_load: number;
    m_ice_load: number;
    m_optimal_exact: boolean;
    m_optimal: number;
    m_two_star_max: number;
    min_moves: number;
    optimal: number;
    par: number;
    /**
     * The fine composite score the board was selected at (LiveProvenance).
     */
    score: number;
    /**
     * The pool seed the chosen board came from (salt-adjusted).
     */
    seed: number;
    /**
     * `(from, to, count, color)` per move of the stored full-information solution.
     */
    solution: Uint8Array;
    two_star_max: number;
}

/**
 * A tap's outcome (F6). `kind`: 0 ignore / 1 select / 2 deselect / 3 pour. For a pour the
 * post-board, revealed concealment, executed move, and cue facts are populated.
 */
export class TapResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    kind: number;
    /**
     * Executed move for kind=pour: from, to, count, color.
     */
    mv: Uint8Array;
    newly_capped: boolean;
    next_cells: Uint8Array;
    next_hidden: Uint16Array;
    /**
     * The new selection for kind=select.
     */
    select_index: number;
    thawed: boolean;
}

/**
 * Core build version, for the diagnostics readout (E9/F5: "show core: wasm/js").
 */
export function core_version(): string;

/**
 * Run the live selection loop (`pickBest`) core-side. `mechanics_mask`: 1 = hidden,
 * 2 = funnel, 4 = ice (registry order is fixed internally). Returns `undefined` when every
 * salted pool comes up empty — the JS side then falls back to its light generator.
 */
export function generate_live(level: number, colors: number, bottles: number, capacity: number, seed: number, mechanics_mask: number, density_hidden: number, density_funnel: number, density_ice: number, target: number, pool_size: number, finalists: number, fine_dead_end_samples: number): LiveLevel | undefined;

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
    readonly __wbg_board_free: (a: number, b: number) => void;
    readonly __wbg_boardview_free: (a: number, b: number) => void;
    readonly __wbg_get_boardview_blocked: (a: number) => [number, number];
    readonly __wbg_get_boardview_capped: (a: number) => [number, number];
    readonly __wbg_get_boardview_frozen: (a: number) => [number, number];
    readonly __wbg_get_boardview_pour_targets: (a: number) => [number, number];
    readonly __wbg_get_boardview_selectable: (a: number) => [number, number];
    readonly __wbg_get_boardview_status: (a: number) => number;
    readonly __wbg_get_livelevel_bottles: (a: number) => number;
    readonly __wbg_get_livelevel_capacity: (a: number) => number;
    readonly __wbg_get_livelevel_cells: (a: number) => [number, number];
    readonly __wbg_get_livelevel_funnels: (a: number) => [number, number];
    readonly __wbg_get_livelevel_hidden: (a: number) => [number, number];
    readonly __wbg_get_livelevel_ice_pairs: (a: number) => [number, number];
    readonly __wbg_get_livelevel_m_colors: (a: number) => number;
    readonly __wbg_get_livelevel_m_dead_end_density: (a: number) => number;
    readonly __wbg_get_livelevel_m_dig_depth: (a: number) => number;
    readonly __wbg_get_livelevel_m_empties: (a: number) => number;
    readonly __wbg_get_livelevel_m_forced_move_ratio: (a: number) => number;
    readonly __wbg_get_livelevel_m_funnel_load: (a: number) => number;
    readonly __wbg_get_livelevel_m_ice_load: (a: number) => number;
    readonly __wbg_get_livelevel_m_optimal: (a: number) => number;
    readonly __wbg_get_livelevel_m_optimal_exact: (a: number) => number;
    readonly __wbg_get_livelevel_m_two_star_max: (a: number) => number;
    readonly __wbg_get_livelevel_min_moves: (a: number) => number;
    readonly __wbg_get_livelevel_optimal: (a: number) => number;
    readonly __wbg_get_livelevel_par: (a: number) => number;
    readonly __wbg_get_livelevel_score: (a: number) => number;
    readonly __wbg_get_livelevel_seed: (a: number) => number;
    readonly __wbg_get_livelevel_solution: (a: number) => [number, number];
    readonly __wbg_get_livelevel_two_star_max: (a: number) => number;
    readonly __wbg_get_tapresult_kind: (a: number) => number;
    readonly __wbg_get_tapresult_newly_capped: (a: number) => number;
    readonly __wbg_get_tapresult_next_cells: (a: number) => [number, number];
    readonly __wbg_get_tapresult_select_index: (a: number) => number;
    readonly __wbg_get_tapresult_thawed: (a: number) => number;
    readonly __wbg_livelevel_free: (a: number, b: number) => void;
    readonly __wbg_set_boardview_blocked: (a: number, b: number, c: number) => void;
    readonly __wbg_set_boardview_capped: (a: number, b: number, c: number) => void;
    readonly __wbg_set_boardview_frozen: (a: number, b: number, c: number) => void;
    readonly __wbg_set_boardview_pour_targets: (a: number, b: number, c: number) => void;
    readonly __wbg_set_boardview_selectable: (a: number, b: number, c: number) => void;
    readonly __wbg_set_boardview_status: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_bottles: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_capacity: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_cells: (a: number, b: number, c: number) => void;
    readonly __wbg_set_livelevel_funnels: (a: number, b: number, c: number) => void;
    readonly __wbg_set_livelevel_hidden: (a: number, b: number, c: number) => void;
    readonly __wbg_set_livelevel_ice_pairs: (a: number, b: number, c: number) => void;
    readonly __wbg_set_livelevel_m_colors: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_dead_end_density: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_dig_depth: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_empties: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_forced_move_ratio: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_funnel_load: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_ice_load: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_optimal: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_optimal_exact: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_m_two_star_max: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_min_moves: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_optimal: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_par: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_score: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_seed: (a: number, b: number) => void;
    readonly __wbg_set_livelevel_solution: (a: number, b: number, c: number) => void;
    readonly __wbg_set_livelevel_two_star_max: (a: number, b: number) => void;
    readonly __wbg_set_tapresult_kind: (a: number, b: number) => void;
    readonly __wbg_set_tapresult_newly_capped: (a: number, b: number) => void;
    readonly __wbg_set_tapresult_next_cells: (a: number, b: number, c: number) => void;
    readonly __wbg_set_tapresult_select_index: (a: number, b: number) => void;
    readonly __wbg_set_tapresult_thawed: (a: number, b: number) => void;
    readonly __wbg_tapresult_free: (a: number, b: number) => void;
    readonly board_force_pour: (a: number, b: number, c: number) => number;
    readonly board_hint: (a: number, b: number) => number;
    readonly board_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly board_tap: (a: number, b: number, c: number) => number;
    readonly board_view: (a: number, b: number, c: number) => number;
    readonly core_version: () => [number, number];
    readonly generate_live: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => number;
    readonly rng_sample: (a: number, b: number) => [number, number];
    readonly stuck_check: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly stuck_reset: (a: number, b: number, c: number, d: number) => void;
    readonly stuck_visit: (a: number, b: number, c: number, d: number) => void;
    readonly stuck_visited_count: () => number;
    readonly __wbg_set_tapresult_next_hidden: (a: number, b: number, c: number) => void;
    readonly __wbg_set_tapresult_mv: (a: number, b: number, c: number) => void;
    readonly __wbg_get_tapresult_mv: (a: number) => [number, number];
    readonly __wbg_get_tapresult_next_hidden: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
