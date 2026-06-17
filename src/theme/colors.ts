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

/**
 * Convert a `#rrggbb` string to CIE Lab. Lab approximates perceptual color space, so plain
 * Euclidean distance between two Lab points (≈ CIE76 ΔE) is a decent "how different do these
 * look" measure — good enough to keep a board's palette visually distinct.
 */
function hexToLab(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [rl, gl, bl] = [lin(r), lin(g), lin(b)];
  // Linear sRGB -> XYZ (D65), then XYZ -> Lab.
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab coordinates per palette id, precomputed once for distance queries. */
const LAB: Record<string, [number, number, number]> = Object.fromEntries(
  Object.entries(COLOR_VALUES).map(([id, hex]) => [id, hexToLab(hex)]),
);

/**
 * Perceptual distance (≈ ΔE) between two palette ids — larger means more visually distinct.
 * Returns 0 for unknown ids. For reference, the closest palette pair (violet/cobalt) is ~11
 * apart and the farthest (lime/cobalt) ~178.
 */
export function colorDistance(a: string, b: string): number {
  const A = LAB[a];
  const B = LAB[b];
  if (!A || !B) return 0;
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
