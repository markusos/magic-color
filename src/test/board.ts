/**
 * Test fixtures for branded `Color` boards. Production colors originate from the palette or a
 * recolor remap; tests build boards from plain string literals, so these helpers brand them in
 * one place rather than scattering `as Color` casts across every spec.
 *
 * Since Track F6 every rule call crosses the wasm boundary, which encodes a color as its
 * PALETTE index — so the fixture shorthands ('r', 'g', 'b', …) are canonicalized to real
 * palette ids here. Specs stay readable and comparisons stay consistent because `color`,
 * `tube`, and `board` all run the same mapping; ids already in the palette pass through.
 */
import { type Bottle, type Color, type GameState, toColor } from '../game/types';

/** Shorthand → palette id. Anything not listed must already be a palette id. */
const SHORTHAND: Record<string, string> = {
  r: 'ruby',
  g: 'emerald',
  b: 'sapphire',
  y: 'amber',
  p: 'amethyst',
  t: 'teal',
  o: 'tangerine',
  m: 'magenta',
};

// Unknown ids pass through untouched: oracle-only specs (engine/mechanic modules) use free-form
// ids on purpose, and a boundary-crossing spec that sneaks one in fails loudly at the adapter
// ("unknown color id") rather than here.
const canonicalId = (id: string): string => SHORTHAND[id] ?? id;

/** Brand a raw string as a Color (shorthand-mapped to a real palette id). */
export const color = (id: string): Color => toColor(canonicalId(id));

/** Brand a raw string array as a Bottle (bottom-first). */
export const tube = (cells: string[]): Bottle => cells.map(color);

/** Build a GameState from raw string bottles. */
export const board = (bottles: string[][], capacity = 4): GameState => ({
  bottles: bottles.map(tube),
  capacity,
});
