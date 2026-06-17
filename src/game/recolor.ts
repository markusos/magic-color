/**
 * Display recoloring. The generator emits every board in canonical palette ids
 * (`PALETTE[0..colors)`), and the level seed fixes the whole *layout* — how many colors there
 * are, which cells share a color, and the solution. This module remaps those ids to a fresh
 * random selection of hues each time a board is loaded or restarted, so a level looks different
 * every play (all "ruby" becomes, say, "sapphire") WITHOUT touching its structure: the engine
 * and solver only ever compare ids for equality, so a consistent bijection is invisible to them
 * — pourability, capping, the win condition, and the optimal move count are all preserved.
 *
 * The remap is drawn from `Math.random` (not the level seed): colors are intentionally NOT
 * reproducible, only the layout is. `random` is injectable so tests can pin the mapping.
 */
import { PALETTE } from './generator';
import type { Color, GameState } from './types';

/** The distinct color ids present in a board, in first-seen (bottom-up, left-to-right) order. */
function distinctIds(state: GameState): Color[] {
  const seen = new Set<Color>();
  const ids: Color[] = [];
  for (const bottle of state.bottles) {
    for (const id of bottle) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * A random bijection from `ids` onto an equally-sized subset of distinct palette hues, drawn
 * from the WHOLE palette (so a level can surface colors it didn't previously use). A partial
 * Fisher–Yates over a palette copy guarantees the chosen targets are all distinct.
 */
export function randomColorMap(
  ids: readonly Color[],
  random: () => number = Math.random,
): Record<string, Color> {
  const pool = [...PALETTE];
  const n = Math.min(ids.length, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  const map: Record<string, Color> = {};
  ids.forEach((id, i) => {
    map[id] = pool[i] ?? id;
  });
  return map;
}

/** Apply a color remap to every segment of a board, returning a new `GameState`. */
export function applyColorMap(state: GameState, map: Record<string, Color>): GameState {
  return {
    ...state,
    bottles: state.bottles.map((bottle) => bottle.map((id) => map[id] ?? id)),
  };
}

/** A freshly recolored copy of a board: identical layout, new random hues. */
export function recolor(state: GameState, random: () => number = Math.random): GameState {
  return applyColorMap(state, randomColorMap(distinctIds(state), random));
}
