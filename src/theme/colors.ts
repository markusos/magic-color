/**
 * Maps palette color ids (used by the engine/generator) to CSS values for rendering.
 * Keep these ids in sync with PALETTE in ../game/generator.ts.
 */
export const COLOR_VALUES: Record<string, string> = {
  ruby: '#e23d54',
  amethyst: '#9b5de5',
  sapphire: '#3a7bd5',
  emerald: '#21bf73',
  amber: '#f5a623',
  rose: '#ff6f91',
  teal: '#14b8a6',
  violet: '#6c5ce7',
  lime: '#a8d600',
  tangerine: '#ff7a1a',
  cobalt: '#2b50e0',
  magenta: '#d6249f',
};

/** CSS color for a palette id, with a neutral fallback. */
export function cssColor(id: string): string {
  return COLOR_VALUES[id] ?? '#888';
}
