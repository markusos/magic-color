/**
 * DEV-ONLY difficulty provenance for the in-app Level Inspector (Track E1). The offline bake records,
 * per baked level, the difficulty `score` it was selected for, the curve `targetPercentile` it was
 * aimed at, and the full `Metrics` it was measured on (see `scripts/build-levels.ts`). That data is
 * committed as a human/diff artifact (`scripts/levels.provenance.json`) and mirrored into a generated,
 * tree-shakeable module (`levels.provenance.ts`, produced by `scripts/emit-provenance.ts`).
 *
 * This module is the app's typed door to that data. The generated board blob is loaded by the runtime;
 * provenance is purely a debugging aid, so it's gated behind `import.meta.env.DEV` and pulled in via a
 * dynamic import that the production build dead-code-eliminates (the early `return` makes the import
 * unreachable once `import.meta.env.DEV` folds to `false`), so it never ships to players.
 */
import type { Metrics } from './difficulty';
import type { Difficulty } from './types';

/** One baked level's bake-time provenance — mirrors the `Provenance` row written by the bake. */
export interface LevelProvenance {
  /** 1-based campaign level number. */
  level: number;
  chapter: number;
  phase: Difficulty;
  /** Shape family the board was drawn from (small / tall / medium / large). */
  family: string;
  /** Compact footprint string, e.g. `7c/10b×4` (colors / bottles × capacity). */
  footprint: string;
  /** Where on the chapter's difficulty distribution this slot was aimed (0..1). */
  targetPercentile: number;
  /** The size-normalized difficulty score the board was selected for. */
  score: number;
  /** The full per-candidate difficulty measurements. */
  metrics: Metrics;
}

/**
 * Difficulty provenance the LIVE generator measures while picking a board (random/endless, the daily,
 * and the un-baked campaign tail). These boards have no committed bake row — the generator computes
 * the same metrics during selection, so we retain the chosen board's instead of discarding them. Unlike
 * the baked rows these are approximate: `metrics.optimal` is the proxy upper bound (the exact A* is too
 * slow at load), and `score` is normalized within that board's generation pool — the inspector marks it
 * "approx". Carried on the live `PlayableLevel`, not loaded from disk, so it's available in any build.
 */
export interface LiveProvenance {
  /** Composite difficulty score, normalized within the generation pool (so pool-relative). */
  score: number;
  /** The curve percentile this board was generated to hit. */
  targetPercentile: number;
  /** Shape family (derived from the footprint, since live boards carry no committed family). */
  family: string;
  /** The chosen board's measured metrics (proxy optimal — `metrics.optimalExact` is false). */
  metrics: Metrics;
}

/** Memoized provenance map (level → row), `null` once we know it's unavailable. `undefined` = not yet loaded. */
let cache: Map<number, LevelProvenance> | null | undefined;

/**
 * Load the whole provenance map (DEV only; `null` in production or if the module hasn't been generated
 * yet). Memoized after the first call. The dynamic import is unreachable in a production bundle — the
 * `import.meta.env.DEV` guard folds to `false` and the rest is dead code, so Rollup drops the chunk.
 */
export async function loadProvenance(): Promise<Map<number, LevelProvenance> | null> {
  if (!import.meta.env.DEV) return null;
  if (cache !== undefined) return cache;
  try {
    const { LEVEL_PROVENANCE } = await import('./levels.provenance');
    cache = new Map(Object.values(LEVEL_PROVENANCE).map((p) => [p.level, p]));
  } catch {
    cache = null; // not generated yet — run `npm run levels:provenance`
  }
  return cache;
}

/** The provenance row for one baked level, or `null` (production, un-baked level, or not yet generated). */
export async function getProvenance(level: number): Promise<LevelProvenance | null> {
  const map = await loadProvenance();
  return map?.get(level) ?? null;
}
