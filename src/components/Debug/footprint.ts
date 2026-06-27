import type { GameState } from '../../game/types';

/** Compact footprint string for a board, e.g. `7c/10b×4` (colors / bottles × capacity). */
export function boardFootprint(state: GameState): string {
  const colors = new Set<string>(state.bottles.flat()).size;
  return `${colors}c/${state.bottles.length}b×${state.capacity}`;
}
