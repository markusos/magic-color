/**
 * The MECHANIC REGISTRY — the one place each board mechanic is described as a first-class object.
 *
 * **Post-F6 this is the DISPLAY-transform half only.** The rules (build-from-solution, blocking,
 * accepts, completion) live in the Rust core (`core/src/*`), reached through `coreWasm.ts`. What
 * remains here is what the JS runtime still does with a board's overlays purely for presentation
 * and storage: shape an all-clear set, permute alongside a bottle re-order (shuffle), recolor for
 * display, and deserialize the committed bake. Each module still only DELEGATES to its mechanic's
 * pure helpers (`recolorFunnels`/`recolorIce`, the grid `empty` shapers) — no rule logic here.
 *
 * (The former interaction methods `blocking`/`accepts`/`incomplete` and the build/serialize/
 * presence machinery were removed with the JS core in F5/F6; adding a mechanic's RULES is now a
 * `core/` change, and its DISPLAY transforms are the small registry below.)
 */
import { emptyGrid, type HiddenGrid } from './hidden';
import { noFunnels, recolorFunnels, type FunnelGrid } from './funnels';
import { noIce, recolorIce, type IceGrid } from './ice';
import type { Color, GameState, Mechanic } from './types';
import { toColor } from './types';

/** The full set of overlays a board can carry — one named field per mechanic. */
export interface OverlaySet {
  hidden: HiddenGrid;
  funnels: FunnelGrid;
  ice: IceGrid;
}

/** The committed JSON form of an overlay set (the fields {@link ../game/baked.BakedLevel} commits). */
export interface SerializedOverlays {
  hidden: boolean[][];
  funnels: (string | null)[];
  ice: (string | null)[][];
}

/**
 * A mechanic's DISPLAY transforms: read/write its overlay in an {@link OverlaySet}, its all-clear
 * default, and the permute/recolor/deserialize the presentation + load paths apply. The generic
 * parameters are the runtime overlay value (`V`) and its committed JSON form (`S`).
 */
interface MechanicModule<V = unknown, S = unknown> {
  get(set: OverlaySet): V;
  put(set: OverlaySet, value: V): OverlaySet;
  empty(state: GameState): V;
  /** Permute the overlay alongside a bottle re-order (shuffle). */
  permute(value: V, perm: readonly number[]): V;
  /** Remap any color tints through a recolor bijection (identity for the colorless `hidden`). */
  recolor(value: V, map: Record<string, Color>): V;
  /** Brand committed JSON back into a runtime overlay. */
  deserialize(raw: S): V;
}

const HIDDEN_MODULE: MechanicModule<HiddenGrid, boolean[][]> = {
  get: (set) => set.hidden,
  put: (set, value) => ({ ...set, hidden: value }),
  empty: emptyGrid,
  permute: (value, perm) => perm.map((i) => value[i]!),
  recolor: (value) => value, // concealment carries no color
  deserialize: (raw) => raw.map((col) => [...col]),
};

const FUNNEL_MODULE: MechanicModule<FunnelGrid, (string | null)[]> = {
  get: (set) => set.funnels,
  put: (set, value) => ({ ...set, funnels: value }),
  empty: noFunnels,
  permute: (value, perm) => perm.map((i) => value[i]!),
  recolor: (value, map) => recolorFunnels(value, map),
  deserialize: (raw) => raw.map((tint) => (tint == null ? null : toColor(tint))),
};

const ICE_MODULE: MechanicModule<IceGrid, (string | null)[][]> = {
  get: (set) => set.ice,
  put: (set, value) => ({ ...set, ice: value }),
  empty: noIce,
  permute: (value, perm) => perm.map((i) => value[i]!),
  recolor: (value, map) => recolorIce(value, map),
  deserialize: (raw) => raw.map((col) => col.map((tint) => (tint == null ? null : toColor(tint)))),
};

const MECHANIC_MODULES: Record<Mechanic, MechanicModule> = {
  hidden: HIDDEN_MODULE,
  funnel: FUNNEL_MODULE,
  ice: ICE_MODULE,
};

/** An all-clear overlay set shaped to a board (every mechanic's empty). */
export function emptyOverlays(state: GameState): OverlaySet {
  return { hidden: emptyGrid(state), funnels: noFunnels(state), ice: noIce(state) };
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

/** Brand committed baked overlay data back into a runtime {@link OverlaySet}. */
export function deserializeOverlays(raw: SerializedOverlays): OverlaySet {
  return {
    hidden: HIDDEN_MODULE.deserialize(raw.hidden),
    funnels: FUNNEL_MODULE.deserialize(raw.funnels),
    ice: ICE_MODULE.deserialize(raw.ice),
  };
}
