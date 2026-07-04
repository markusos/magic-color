/**
 * G1 shared-vector conformance for the PRNG, JS side (Track F). The committed
 * `vectors/rng.json` is emitted from this very implementation (`scripts/emit-vectors.ts`), so
 * this test's real job is pinning: if `rng.ts` ever changes, it fails until the vectors are
 * deliberately re-emitted — and the Rust side (`core/tests/rng_vectors.rs`) fails with it,
 * forcing both implementations to move together.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';

const vectorsPath = join(dirname(fileURLToPath(import.meta.url)), '../../vectors/rng.json');

interface RngVectors {
  mulberry32: { seed: number; draws: number[] }[];
}

describe('mulberry32 shared vectors', () => {
  const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as RngVectors;

  it('has cases to assert', () => {
    expect(vectors.mulberry32.length).toBeGreaterThan(0);
  });

  it.each(vectors.mulberry32)('seed $seed replays exactly', ({ seed, draws }) => {
    const rng = mulberry32(seed);
    // Draws are stored as raw u32; the float is u32/2^32, so scaling back up is exact.
    for (const expected of draws) expect(rng() * 4294967296).toBe(expected);
  });
});
