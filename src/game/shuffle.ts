/**
 * Tube-order shuffle: a display transform that randomizes the left-to-right position of a board's
 * bottles. Like {@link ./recolor}, it changes only presentation — a tube has no identity, so
 * permuting positions is invisible to the engine and solver (every pour simply relabels with the
 * permutation). Solvability, par, and the optimal move count are all preserved. Re-rolled on every
 * restart, it stops a solved level from being replayed purely from positional muscle memory, the
 * same reason colors are re-rolled.
 *
 * Every overlay has one entry per bottle, so the whole {@link OverlaySet} permutes in lockstep with
 * the bottles — driven generically off the mechanic registry, so a new mechanic needs no change here.
 */
import { permuteOverlays, type OverlaySet } from './mechanics';
import type { GameState } from './types';

/** A random permutation of `[0, n)` via Fisher–Yates. */
function randomPermutation(n: number, random: () => number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  return perm;
}

/**
 * A copy of the board with its bottles — and the parallel overlay set — in a fresh random order.
 * `random` is injectable so tests can pin the permutation; gameplay uses `Math.random`, so the order is
 * intentionally NOT reproducible (only the layout is).
 */
export function shuffleBottles(
  state: GameState,
  overlays: OverlaySet,
  random: () => number = Math.random,
): { state: GameState; overlays: OverlaySet } {
  const perm = randomPermutation(state.bottles.length, random);
  return {
    state: { ...state, bottles: perm.map((i) => state.bottles[i]!) },
    overlays: permuteOverlays(overlays, perm),
  };
}
