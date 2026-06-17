/**
 * Deterministic pseudo-random number generators. Kept dependency-free so any module — the
 * level generator, the hidden-colors mechanic, tests — can seed reproducible randomness
 * without pulling in game logic.
 */

/**
 * Mulberry32 — a tiny, fast, deterministic PRNG. Seeding makes generated levels
 * reproducible, which keeps tests stable and lets us share a level by its seed.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
