/**
 * Test fixtures for branded `Color` boards. Production colors originate from the palette or a
 * recolor remap; tests build boards from plain string literals, so these helpers brand them in
 * one place rather than scattering `as Color` casts across every spec.
 */
import { type Bottle, type Color, type GameState, toColor } from '../game/types';

/** Brand a raw string as a Color (via the shared {@link toColor} factory). */
export const color = (id: string): Color => toColor(id);

/** Brand a raw string array as a Bottle (bottom-first). */
export const tube = (cells: string[]): Bottle => cells as Bottle;

/** Build a GameState from raw string bottles. */
export const board = (bottles: string[][], capacity = 4): GameState => ({
  bottles: bottles as Bottle[],
  capacity,
});
