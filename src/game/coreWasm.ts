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
  board_view,
  cheat_force_pour,
  core_version,
  generate_live,
  hint,
  rng_sample,
  stuck_check,
  stuck_reset,
  stuck_visit,
  stuck_visited_count,
  tap,
  initSync,
} from './core-pkg/magic_color_core';
import type { FunnelGrid } from './funnels';
import type { HiddenGrid } from './hidden';
import type { IceGrid } from './ice';
import type { Overlays } from './overlays';
import { PALETTE } from './palette';
import type { Metrics } from './provenance';
import { toColor, type Color, type GameState, type Move } from './types';

/** A suggested pour (source → destination) — the hint contract. Runtime home since F5. */
export interface HintMove {
  from: number;
  to: number;
}

/** The hint worker's request message (`coreHintWorker.ts`). */
export interface HintRequest {
  state: GameState;
  hidden: HiddenGrid;
  overlays: Overlays;
  maxNodes: number;
}

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
 * The first move of an optimal continuation, via the Rust core (`null` = solved / stuck /
 * budget exhausted / core not ready — or a board the boundary can't encode, e.g. an
 * admin-injected test board with non-palette color ids).
 */
export function wasmHintMove(
  state: GameState,
  hidden: HiddenGrid,
  overlays: Overlays | undefined,
  maxNodes: number,
): HintMove | null {
  if (!ready) return null;
  let encoded: number;
  try {
    const n = state.bottles.length;
    encoded = hint(
      encodeCells(state),
      n,
      state.capacity,
      encodeHidden(hidden),
      encodeFunnels(overlays?.funnels, n),
      encodeIce(overlays?.ice, n),
      maxNodes,
    );
  } catch {
    return null; // unencodable board — "no hint" beats a crash
  }
  if (encoded < 0) return null;
  return { from: encoded >> 8, to: encoded & 0xff };
}

/** The plan fields the live selection loop needs (a `LevelPlan` slice — no import to avoid a cycle). */
export interface WasmLivePlan {
  level: number;
  colors: number;
  bottles: number;
  capacity: number;
  seed: number;
  mechanics: readonly string[];
  density: Record<string, number>;
}

/** What the core's live pick returns — everything `levelLoader.toPlayable` assembles from. */
export interface WasmLivePick {
  state: GameState;
  solution: Move[];
  hidden: HiddenGrid;
  funnels: FunnelGrid;
  ice: IceGrid;
  optimal: number;
  twoStarMax: number;
  par: number;
  minMoves: number;
  seed: number;
  score: number;
  metrics: Metrics;
}

/**
 * The whole coarse-to-fine live selection (`pickBest`) run core-side — Track F3's live-gen
 * seam. `null` when the core isn't ready OR every salted pool came up empty; the caller falls
 * back to the JS path either way.
 */
export function wasmPickBest(
  plan: WasmLivePlan,
  target: number,
  config: { poolSize: number; finalists: number; fineDeadEndSamples: number },
): WasmLivePick | null {
  if (!ready) return null;
  const mask =
    (plan.mechanics.includes('hidden') ? 1 : 0) |
    (plan.mechanics.includes('funnel') ? 2 : 0) |
    (plan.mechanics.includes('ice') ? 4 : 0);
  const picked = generate_live(
    plan.level,
    plan.colors,
    plan.bottles,
    plan.capacity,
    plan.seed >>> 0,
    mask,
    plan.density.hidden ?? 0,
    plan.density.funnel ?? 0,
    plan.density.ice ?? 0,
    target,
    config.poolSize,
    config.finalists,
    config.fineDeadEndSamples,
  );
  if (!picked) return null;

  const { bottles: n, capacity: cap } = picked;
  const cells = picked.cells;
  const bottles: Color[][] = [];
  for (let b = 0; b < n; b++) {
    const col: Color[] = [];
    for (let i = 0; i < cap; i++) {
      const c = cells[b * cap + i]!;
      if (c === NO_COLOR) break;
      col.push(toColor(PALETTE[c]!));
    }
    bottles.push(col);
  }
  const state: GameState = { bottles, capacity: cap };

  const solution: Move[] = [];
  for (let i = 0; i < picked.solution.length; i += 4) {
    solution.push({
      from: picked.solution[i]!,
      to: picked.solution[i + 1]!,
      count: picked.solution[i + 2]!,
      color: toColor(PALETTE[picked.solution[i + 3]!]!),
    });
  }

  const hidden: HiddenGrid = bottles.map((col, b) => col.map((_, i) => (picked.hidden[b]! & (1 << i)) !== 0));
  const funnels: FunnelGrid = Array.from(picked.funnels, (f) => (f === NO_COLOR ? null : toColor(PALETTE[f]!)));
  const ice: IceGrid = bottles.map((col, b) => {
    const trigger = picked.ice_pairs[b * 2]!;
    const height = picked.ice_pairs[b * 2 + 1]!;
    return col.map((_, i) =>
      trigger !== NO_COLOR && i < height ? toColor(PALETTE[trigger]!) : null,
    );
  });

  const result: WasmLivePick = {
    state,
    solution,
    hidden,
    funnels,
    ice,
    optimal: picked.optimal,
    twoStarMax: picked.two_star_max,
    par: picked.par,
    minMoves: picked.min_moves,
    seed: picked.seed,
    score: picked.score,
    metrics: {
      optimal: picked.m_optimal,
      optimalExact: picked.m_optimal_exact,
      twoStarMax: picked.m_two_star_max,
      forcedMoveRatio: picked.m_forced_move_ratio,
      deadEndDensity: picked.m_dead_end_density,
      digDepth: picked.m_dig_depth,
      funnelLoad: picked.m_funnel_load,
      iceLoad: picked.m_ice_load,
      colors: picked.m_colors,
      empties: picked.m_empties,
    },
  };
  picked.free(); // wasm-bindgen struct — release the linear-memory allocation promptly
  return result;
}

// -----------------------------------------------------------------------------------------
// F6: the gameplay session surface. One `wasmBoardView` per state answers everything the UI
// renders and gates on; one `wasmPlanTap` decides a tap. JS holds no rule semantics.
// -----------------------------------------------------------------------------------------

/** The board snapshot the UI renders from — decoded `core::session::View`. */
export interface BoardViewSnapshot {
  status: 'playing' | 'won' | 'deadlocked' | 'stuck';
  /** Per-cell "blocks the run / capping" flags (concealed + still-frozen), current shape. */
  blocked: boolean[][];
  /** Per-cell still-frozen flags (the ice tint rendering). */
  frozen: boolean[][];
  /** Legal pour source per tube. */
  selectable: boolean[];
  /** Finished-tube visual per tube. */
  capped: boolean[];
  /** Legal pour destination per tube from `selected` (all-false without a selection). */
  pourTargets: boolean[];
}

const STATUS_NAMES = ['playing', 'won', 'deadlocked', 'stuck'] as const;

/** Node budget for the stuck-loop leg of a status derivation (matches the old JS default). */
const STUCK_NODE_BUDGET = 20_000;

const masksToGrid = (state: GameState, masks: Uint16Array): boolean[][] =>
  state.bottles.map((col, b) => col.map((_, i) => (masks[b]! & (1 << i)) !== 0));

/**
 * The full board snapshot (F6). `checkStuck` gates the loop-check leg: the STORE passes true
 * when deriving a committed status (the check consults the core-side visited registry);
 * render-path callers pass false, making the call microseconds-cheap.
 */
export function wasmBoardView(
  state: GameState,
  hidden: HiddenGrid,
  overlays: Overlays | undefined,
  selected: number | null,
  checkStuck: boolean,
): BoardViewSnapshot {
  if (!ready) throw new Error('[core-wasm] not initialized');
  const n = state.bottles.length;
  const v = board_view(
    encodeCells(state),
    n,
    state.capacity,
    encodeHidden(hidden),
    encodeFunnels(overlays?.funnels, n),
    encodeIce(overlays?.ice, n),
    selected ?? -1,
    checkStuck ? STUCK_NODE_BUDGET : 0,
  );
  const snapshot: BoardViewSnapshot = {
    status: STATUS_NAMES[v.status]!,
    blocked: masksToGrid(state, v.blocked),
    frozen: masksToGrid(state, v.frozen),
    selectable: Array.from(v.selectable, (x) => x !== 0),
    capped: Array.from(v.capped, (x) => x !== 0),
    pourTargets: Array.from(v.pour_targets, (x) => x !== 0),
  };
  v.free();
  return snapshot;
}

/** A tap's decided outcome — decoded `core::session::TapOutcome` (mirrors the old TapPlan). */
export type WasmTapPlan =
  | { kind: 'ignore' }
  | { kind: 'select'; selected: number }
  | { kind: 'deselect' }
  | {
      kind: 'pour';
      next: GameState;
      move: Move;
      revealedHidden: HiddenGrid;
      /** Cue facts (computed core-side): a frozen cell thawed / a color newly capped. */
      thawed: boolean;
      newlyCapped: boolean;
    };

const decodeTapPour = (
  r: { next_cells: Uint8Array; next_hidden: Uint16Array; mv: Uint8Array },
  capacity: number,
  bottles: number,
): { next: GameState; move: Move; revealedHidden: HiddenGrid } => {
  const cols: Color[][] = [];
  for (let b = 0; b < bottles; b++) {
    const col: Color[] = [];
    for (let i = 0; i < capacity; i++) {
      const c = r.next_cells[b * capacity + i]!;
      if (c === NO_COLOR) break;
      col.push(toColor(PALETTE[c]!));
    }
    cols.push(col);
  }
  const next: GameState = { bottles: cols, capacity };
  return {
    next,
    move: {
      from: r.mv[0]!,
      to: r.mv[1]!,
      count: r.mv[2]!,
      color: toColor(PALETTE[r.mv[3]!]!),
    },
    revealedHidden: cols.map((col, b) => col.map((_, i) => (r.next_hidden[b]! & (1 << i)) !== 0)),
  };
};

/** Decide what tapping `i` does (F6) — the core-side `planTap`. */
export function wasmPlanTap(
  state: GameState,
  hidden: HiddenGrid,
  overlays: Overlays | undefined,
  selected: number | null,
  i: number,
): WasmTapPlan {
  if (!ready) throw new Error('[core-wasm] not initialized');
  const n = state.bottles.length;
  const r = tap(
    encodeCells(state),
    n,
    state.capacity,
    encodeHidden(hidden),
    encodeFunnels(overlays?.funnels, n),
    encodeIce(overlays?.ice, n),
    selected ?? -1,
    i,
  );
  const out: WasmTapPlan =
    r.kind === 0
      ? { kind: 'ignore' }
      : r.kind === 1
        ? { kind: 'select', selected: r.select_index }
        : r.kind === 2
          ? { kind: 'deselect' }
          : {
              kind: 'pour',
              ...decodeTapPour(r, state.capacity, n),
              thawed: r.thawed,
              newlyCapped: r.newly_capped,
            };
  r.free();
  return out;
}

/** The free-pour cheat (F6): engine geometry only, mechanics ignored. `null` = nothing moves. */
export function wasmForcePour(
  state: GameState,
  hidden: HiddenGrid,
  from: number,
  to: number,
): { next: GameState; move: Move; revealedHidden: HiddenGrid } | null {
  if (!ready) throw new Error('[core-wasm] not initialized');
  const n = state.bottles.length;
  const r = cheat_force_pour(encodeCells(state), n, state.capacity, encodeHidden(hidden), from, to);
  const out = r.kind === 3 ? decodeTapPour(r, state.capacity, n) : null;
  r.free();
  return out;
}

/**
 * Core-side stuck-loop detection. Mirrors the store's visited-set lifecycle: `reset` when a
 * board is installed, `visit` after every applied move, `check` when deriving status. All
 * no-ops / non-committal until the wasm is ready — callers keep the JS check as fallback.
 */
export const wasmStuck = {
  // All fail-soft on unencodable boards (admin-injected fixtures with non-palette ids): a
  // board the registry can't track just means the stuck nudge stays quiet — the check only
  // ever under-fires, which is its safe direction.
  reset(state: GameState): void {
    if (!ready) return;
    try {
      stuck_reset(encodeCells(state), state.bottles.length, state.capacity);
    } catch {
      /* untrackable board — leave the registry as-is */
    }
  },
  visit(state: GameState): void {
    if (!ready) return;
    try {
      stuck_visit(encodeCells(state), state.bottles.length, state.capacity);
    } catch {
      /* untrackable board */
    }
  },
  /** `null` = core not ready or board unencodable (no verdict — treat as "not stuck"). */
  check(state: GameState, funnels: Overlays['funnels'], maxNodes: number): boolean | null {
    if (!ready) return null;
    try {
      const n = state.bottles.length;
      return stuck_check(encodeCells(state), n, state.capacity, encodeFunnels(funnels, n), maxNodes);
    } catch {
      return null;
    }
  },
  /** Registry size, for diagnostics/tests. */
  visitedCount(): number {
    return ready ? stuck_visited_count() : 0;
  },
};
