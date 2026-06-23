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
import { recolorOverlays, type OverlaySet } from './mechanics';
import { colorDistance } from '../theme/colors';
import type { Color, GameState } from './types';

/** The distinct color ids present in a board, in first-seen (bottom-up, left-to-right) order. */
export function distinctIds(state: GameState): Color[] {
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
 * How close (Lab ΔE) a chosen hue may sit to the most-distinct remaining candidate and still be
 * eligible — a small slack that keeps the palette varied between plays without admitting a
 * genuinely confusable pair. Palette clusters (e.g. violet/cobalt) sit ~11 apart; spread subsets
 * stay far above that.
 */
const SPREAD_TOLERANCE = 10;

/**
 * Choose `count` palette hues that are perceptually spread out, via farthest-point sampling:
 * begin at a random hue, then repeatedly add the candidate whose nearest already-chosen hue is
 * furthest away (ties within {@link SPREAD_TOLERANCE} broken randomly, for variety). This keeps
 * the small palettes of easy/normal boards visually distinct — no two near-identical hues. A full
 * 12-color (hard) board necessarily uses every hue, so spreading is a no-op there; close colors
 * remain, which is acceptable difficulty at that level.
 */
export function pickSpreadSubset(count: number, random: () => number = Math.random): Color[] {
  const pool = [...PALETTE];
  const n = Math.min(Math.max(count, 0), pool.length);
  if (n === 0) return [];

  const startIndex = Math.floor(random() * pool.length);
  const chosen: Color[] = [pool[startIndex]!];
  const remaining = pool.filter((_, i) => i !== startIndex);

  while (chosen.length < n && remaining.length > 0) {
    // Distance from each remaining hue to its nearest already-chosen hue.
    const nearest = remaining.map((c) => Math.min(...chosen.map((s) => colorDistance(c, s))));
    const best = Math.max(...nearest);
    const eligible = remaining.filter((_, i) => nearest[i]! >= best - SPREAD_TOLERANCE);
    const pick = eligible[Math.floor(random() * eligible.length)]!;
    chosen.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }

  // Shuffle so the id->hue assignment varies too, not just which hues are present.
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j]!, chosen[i]!];
  }
  return chosen;
}

/**
 * A bijection from `ids` onto a perceptually distinct subset of palette hues (see
 * {@link pickSpreadSubset}), drawn from the WHOLE palette so a level can surface hues it didn't
 * previously use, and re-rolled each play.
 */
export function randomColorMap(
  ids: readonly Color[],
  random: () => number = Math.random,
): Record<string, Color> {
  const targets = pickSpreadSubset(ids.length, random);
  const map: Record<string, Color> = {};
  ids.forEach((id, i) => {
    map[id] = targets[i] ?? id;
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

/**
 * Recolor a board AND its overlay set under ONE fresh random bijection, so the funnel rings and the ice
 * tints all stay matched to the recolored liquid (concealment carries no color, so it passes through).
 * This is what installs a board for display; callers keep the canonical `initial`/`initialOverlays`
 * untouched so each restart re-rolls afresh.
 */
export function recolorBoard(
  state: GameState,
  overlays: OverlaySet,
  random: () => number = Math.random,
): { board: GameState; overlays: OverlaySet } {
  const map = randomColorMap(distinctIds(state), random);
  return {
    board: applyColorMap(state, map),
    overlays: recolorOverlays(overlays, map),
  };
}
