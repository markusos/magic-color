/**
 * Tube-order shuffle: a display transform that randomizes the left-to-right position of a board's
 * bottles. Like {@link ./recolor}, it changes only presentation — a tube has no identity, so
 * permuting positions is invisible to the engine and solver (every pour simply relabels with the
 * permutation). Solvability, par, and the optimal move count are all preserved. Re-rolled on every
 * restart, it stops a solved level from being replayed purely from positional muscle memory, the
 * same reason colors are re-rolled.
 *
 * The hidden-colors grid has one row per bottle, so it is permuted in lockstep with the bottles.
 */
import type { GameState } from './types';
import type { HiddenGrid } from './hidden';

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
 * A copy of the board with its bottles — and the parallel concealment grid — in a fresh random
 * order. `random` is injectable so tests can pin the permutation; gameplay uses `Math.random`, so
 * the order is intentionally NOT reproducible (only the layout is).
 */
export function shuffleBottles(
  state: GameState,
  hidden: HiddenGrid,
  random: () => number = Math.random,
): { state: GameState; hidden: HiddenGrid } {
  const perm = randomPermutation(state.bottles.length, random);
  return {
    state: { ...state, bottles: perm.map((i) => state.bottles[i]!) },
    hidden: perm.map((i) => hidden[i]!),
  };
}
