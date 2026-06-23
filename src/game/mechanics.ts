/**
 * The MECHANIC REGISTRY — the one place each board mechanic is described as a first-class object, so
 * the level pipeline (generate → build overlays → shuffle/recolor for display → serialize for the bake
 * → deserialize at load) iterates a registry instead of naming `hidden`/`funnel`/`ice` literally at a
 * dozen call sites. Adding a chapter's mechanic becomes: write its overlay module (in `hidden.ts` /
 * `funnels.ts` / `ice.ts` / a new sibling), register it here, and add its data field to the few stored
 * shapes (`OverlaySet`, `BakedLevel`, the store, the UI). Everything else — building from the solution,
 * permuting on shuffle, recoloring, the bake's "must show the mechanic" filter, (de)serialization — is
 * driven generically off the registry.
 *
 * Crucially, each {@link MechanicModule} only DELEGATES to the mechanic's existing pure functions
 * (`computeHidden`/`computeFunnels`/`buildIce`, …) in the exact same order with the exact same args —
 * no rule logic lives here. That's what lets this refactor reproduce earlier chapters byte-identically
 * on a re-bake: the registry changes dispatch, never computation.
 *
 * Relationship to {@link ./overlays}: `Overlays` there is the STATIC subset (`{ funnels?, ice? }`)
 * threaded through the solver/search/metrics alongside the separately-carried `hidden`. `OverlaySet`
 * here is the FULL board overlay set the pipeline builds and stores; {@link staticOverlays} adapts one
 * to the other.
 */
import { anyHidden, computeHidden, emptyGrid, exposableCells, type HiddenGrid } from './hidden';
import {
  anyFunnel,
  computeFunnels,
  funnelAccepts,
  funnelEligibleTubes,
  noFunnels,
  recolorFunnels,
  type FunnelGrid,
} from './funnels';
import { anyFrozen, anyIce, buildIce, frozenCells, noIce, recolorIce, type IceGrid } from './ice';
import type { Overlays } from './overlays';
import type { Color, GameState, Mechanic, Move } from './types';
import { toColor } from './types';

/** The full set of overlays a board can carry — one named field per mechanic. */
export interface OverlaySet {
  hidden: HiddenGrid;
  funnels: FunnelGrid;
  ice: IceGrid;
}

/** The static-overlay view {@link ./overlays.Overlays} the solver/search/metrics consume. */
export function staticOverlays(set: OverlaySet): Overlays {
  return { funnels: set.funnels, ice: set.ice };
}

/** What a module needs to compute a board's initial overlay from its solved-by-construction solution. */
export interface BuildContext {
  state: GameState;
  solution: Move[];
  /** Level seed; each module decorrelates its own draws internally (its own XOR constant). */
  seed: number;
  /** Application density (fraction of eligible tubes/cells) for THIS mechanic. */
  prob: number;
  /** Overlays already built earlier in the ordered pass — lets `ice` read the chosen `hidden` grid. */
  prior: OverlaySet;
}

/**
 * A mechanic as a first-class object: how to read/write its overlay in an {@link OverlaySet}, an
 * all-clear default, an "is it doing anything" check, and the lifecycle transforms (build from a
 * solution, permute on shuffle, recolor for display, (de)serialize for the bake). The generic
 * parameters are the runtime overlay value (`V`) and its committed JSON form (`S`); the registry erases
 * them so the pipeline can compose the transforms opaquely.
 */
export interface MechanicModule<V = unknown, S = unknown> {
  readonly id: Mechanic;
  /**
   * Must every level in this mechanic's signature chapter visibly SHOW it? Funnels and ice do (the bake
   * filters out candidates that ended up without one); hidden does not.
   */
  readonly requiresPresence: boolean;
  /** Read this mechanic's overlay out of a full set. */
  get(set: OverlaySet): V;
  /** A copy of `set` with this mechanic's overlay replaced. */
  put(set: OverlaySet, value: V): OverlaySet;
  /** The all-clear overlay shaped to a board (used outside this mechanic's chapters and for resets). */
  empty(state: GameState): V;
  /** Whether this overlay is doing anything on the board. */
  isActive(value: V): boolean;
  /** Compute the initial overlay from a generated, solved board. */
  build(ctx: BuildContext): V;
  /** Permute the overlay alongside a bottle re-order (shuffle). */
  permute(value: V, perm: readonly number[]): V;
  /** Remap any color tints through a recolor bijection (identity for the colorless `hidden`). */
  recolor(value: V, map: Record<string, Color>): V;
  /** The committed JSON form for the level bake. */
  serialize(value: V): S;
  /** Brand committed JSON back into a runtime overlay. */
  deserialize(raw: S): V;

  // --- Interaction (gameplay rules the store/UI consult; all optional, default = no effect) ---

  /**
   * Per-cell columns this mechanic BLOCKS — cells that stop the visible pour run and prevent capping,
   * exactly like a hidden "?". `hidden` blocks its concealed cells; `ice` blocks its still-frozen cells;
   * `funnel` blocks nothing (it constrains destinations, not the source run). Merged across mechanics by
   * {@link blockedColumns}. Omit ⇒ contributes nothing.
   */
  blocking?(set: OverlaySet, state: GameState): HiddenGrid;
  /**
   * Whether tube `to` accepts an inflow of `color` under this mechanic. `funnel` rejects a mismatched
   * tint; others accept anything. AND-ed across mechanics by {@link acceptsPour}. Omit ⇒ always accepts.
   */
  accepts?(set: OverlaySet, to: number, color: Color): boolean;
  /**
   * Whether this mechanic keeps the board UNFINISHED even when every bottle is sorted — `hidden` while a
   * "?" remains, `ice` while a block is still frozen. OR-ed across mechanics by {@link blocksCompletion}.
   * Omit ⇒ never blocks completion.
   */
  incomplete?(set: OverlaySet, state: GameState): boolean;
}

const HIDDEN_MODULE: MechanicModule<HiddenGrid, boolean[][]> = {
  id: 'hidden',
  requiresPresence: false,
  get: (set) => set.hidden,
  put: (set, value) => ({ ...set, hidden: value }),
  empty: emptyGrid,
  isActive: anyHidden,
  build: ({ state, solution, seed, prob }) =>
    computeHidden(state, seed, exposableCells(state, solution), prob),
  permute: (value, perm) => perm.map((i) => value[i]!),
  recolor: (value) => value, // concealment carries no color
  serialize: (value) => value.map((col) => [...col]),
  deserialize: (raw) => raw.map((col) => [...col]),
  blocking: (set) => set.hidden, // concealed cells block the run and capping
  incomplete: (set) => anyHidden(set.hidden), // a still-hidden "?" keeps a tube unfinished
};

const FUNNEL_MODULE: MechanicModule<FunnelGrid, (string | null)[]> = {
  id: 'funnel',
  requiresPresence: true,
  get: (set) => set.funnels,
  put: (set, value) => ({ ...set, funnels: value }),
  empty: noFunnels,
  isActive: anyFunnel,
  build: ({ state, solution, seed, prob }) =>
    computeFunnels(state, seed, funnelEligibleTubes(state, solution), prob),
  permute: (value, perm) => perm.map((i) => value[i]!),
  recolor: (value, map) => recolorFunnels(value, map),
  serialize: (value) => value.map((tint) => tint ?? null),
  deserialize: (raw) => raw.map((tint) => (tint == null ? null : toColor(tint))),
  accepts: (set, to, color) => funnelAccepts(set.funnels, to, color), // only the tube's tint may pour in
};

const ICE_MODULE: MechanicModule<IceGrid, (string | null)[][]> = {
  id: 'ice',
  requiresPresence: true,
  get: (set) => set.ice,
  put: (set, value) => ({ ...set, ice: value }),
  empty: noIce,
  isActive: anyIce,
  // Ice keys its thaw on capping (a fully-revealed tube), so it derives from the chosen hidden grid.
  build: ({ state, solution, seed, prob, prior }) =>
    buildIce(state, solution, prior.hidden, seed, prob),
  permute: (value, perm) => perm.map((i) => value[i]!),
  recolor: (value, map) => recolorIce(value, map),
  serialize: (value) => value.map((col) => col.map((tint) => tint ?? null)),
  deserialize: (raw) => raw.map((col) => col.map((tint) => (tint == null ? null : toColor(tint)))),
  blocking: (set, state) => frozenCells(state, set.hidden, set.ice), // frozen cells block like a "?"
  incomplete: (set, state) => anyFrozen(state, set.hidden, set.ice), // a frozen block keeps a tube unfinished
};

/**
 * Registry iteration order. `hidden` precedes `ice` because ice's build reads the chosen hidden grid;
 * the bake's presence filters apply in this order too (independent, so the order is immaterial there).
 * This order is load-bearing for byte-identical bakes — do not reorder without re-baking.
 */
export const MECHANIC_ORDER: readonly Mechanic[] = ['hidden', 'funnel', 'ice'];

/** Every mechanic as a first-class module, keyed by id. */
export const MECHANIC_MODULES: Record<Mechanic, MechanicModule> = {
  hidden: HIDDEN_MODULE,
  funnel: FUNNEL_MODULE,
  ice: ICE_MODULE,
};

/** The modules for the active mechanics, in registry order. */
function activeModules(mechanics: readonly Mechanic[]): MechanicModule[] {
  return MECHANIC_ORDER.filter((id) => mechanics.includes(id)).map((id) => MECHANIC_MODULES[id]);
}

/** An all-clear overlay set shaped to a board (every mechanic's empty). */
export function emptyOverlays(state: GameState): OverlaySet {
  return { hidden: emptyGrid(state), funnels: noFunnels(state), ice: noIce(state) };
}

/**
 * Build a board's initial overlays from its solution: each ACTIVE mechanic's `build` in registry order
 * (so `ice` sees the chosen `hidden`), inactive mechanics left all-clear. `prob` per mechanic comes from
 * the level's `density`. Mirrors the old per-mechanic `hiddenFor`/`funnelsFor`/`iceFor` exactly.
 */
export function buildOverlays(
  mechanics: readonly Mechanic[],
  ctx: { state: GameState; solution: Move[]; seed: number; density: Record<Mechanic, number> },
): OverlaySet {
  let set = emptyOverlays(ctx.state);
  for (const mod of activeModules(mechanics)) {
    const value = mod.build({
      state: ctx.state,
      solution: ctx.solution,
      seed: ctx.seed,
      prob: ctx.density[mod.id],
      prior: set,
    });
    set = mod.put(set, value);
  }
  return set;
}

/** Permute every overlay alongside a bottle re-order (shuffle). */
export function permuteOverlays(set: OverlaySet, perm: readonly number[]): OverlaySet {
  let out = set;
  for (const mod of Object.values(MECHANIC_MODULES)) {
    out = mod.put(out, mod.permute(mod.get(out), perm));
  }
  return out;
}

/** Recolor every overlay's tints through one bijection (the same map the board is recolored with). */
export function recolorOverlays(set: OverlaySet, map: Record<string, Color>): OverlaySet {
  let out = set;
  for (const mod of Object.values(MECHANIC_MODULES)) {
    out = mod.put(out, mod.recolor(mod.get(out), map));
  }
  return out;
}

/** The committed JSON form of an overlay set, named to match {@link ../game/baked.BakedLevel}. */
export interface SerializedOverlays {
  hidden: boolean[][];
  funnels: (string | null)[];
  ice: (string | null)[][];
}

/** Serialize every overlay for the bake (the named fields {@link ../game/baked.BakedLevel} commits). */
export function serializeOverlays(set: OverlaySet): SerializedOverlays {
  return {
    hidden: HIDDEN_MODULE.serialize(set.hidden),
    funnels: FUNNEL_MODULE.serialize(set.funnels),
    ice: ICE_MODULE.serialize(set.ice),
  };
}

/** Brand committed baked overlay data back into a runtime {@link OverlaySet}. */
export function deserializeOverlays(raw: SerializedOverlays): OverlaySet {
  return {
    hidden: HIDDEN_MODULE.deserialize(raw.hidden),
    funnels: FUNNEL_MODULE.deserialize(raw.funnels),
    ice: ICE_MODULE.deserialize(raw.ice),
  };
}

/**
 * Drop pool candidates that don't visibly show a `requiresPresence` mechanic of the chapter — so every
 * funnel/ice level actually presents one (mirrors the old hand-written funnel/ice filters in the bake).
 * Candidates are read structurally as overlay sets (the bake's `Candidate` carries the named fields).
 */
export function filterPresence<T extends OverlaySet>(pool: T[], mechanics: readonly Mechanic[]): T[] {
  let out = pool;
  for (const mod of activeModules(mechanics)) {
    if (mod.requiresPresence) out = out.filter((c) => mod.isActive(mod.get(c)));
  }
  return out;
}

/**
 * The per-cell columns a pour's source run / capping must treat as BLOCKED — every mechanic's blocking
 * contribution OR-ed together (concealed "?"s plus still-frozen ice). Shaped to the current bottles, so
 * it indexes alongside `knownTopRun`/`isCapped`. With no blocking mechanic active it's all-false.
 */
export function blockedColumns(set: OverlaySet, state: GameState): HiddenGrid {
  const grids = Object.values(MECHANIC_MODULES)
    .map((mod) => mod.blocking?.(set, state))
    .filter((g): g is HiddenGrid => g !== undefined);
  return state.bottles.map((bottle, b) => bottle.map((_, i) => grids.some((g) => g[b]?.[i] ?? false)));
}

/** Whether tube `to` accepts an inflow of `color` — every mechanic's destination rule AND-ed together. */
export function acceptsPour(set: OverlaySet, to: number, color: Color): boolean {
  return Object.values(MECHANIC_MODULES).every((mod) => mod.accepts?.(set, to, color) ?? true);
}

/**
 * Whether any mechanic keeps the board UNFINISHED even though every bottle is sorted (a still-hidden "?"
 * or a still-frozen ice block) — OR-ed across mechanics. A board is won only when `isWon` AND this is
 * false.
 */
export function blocksCompletion(set: OverlaySet, state: GameState): boolean {
  return Object.values(MECHANIC_MODULES).some((mod) => mod.incomplete?.(set, state) ?? false);
}
