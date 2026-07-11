/**
 * DEV-ONLY difficulty provenance for the in-app Level Inspector (Track E1). The offline bake records,
 * per baked level, the difficulty `score` it was selected for, the curve `targetPercentile` it was
 * aimed at, and the full `Metrics` it was measured on (see `scripts/build-levels.ts`). That data is
 * committed as a human/diff artifact (`scripts/levels.provenance.json`) and mirrored into a generated,
 * tree-shakeable module (`levels.provenance.ts`, produced by `scripts/emit-provenance.ts`).
 *
 * This module is the app's typed door to that data. It's purely a debugging aid surfaced only through the
 * hidden admin inspector, and it's pulled in via a DYNAMIC import so the metrics blob lands in its own
 * lazily-fetched chunk — never in the main bundle, and only downloaded once an admin opens the inspector.
 * (Access control is the admin hatch, not the build mode — see `store/settings.ts` `inspector`.)
 */
import type { Difficulty } from './types';

/**
 * Per-board difficulty measurements — the committed/live provenance schema. This is the
 * RUNTIME home of the type since Track F5 (the measuring code lives in the Rust core;
 * the retired JS `difficulty.ts` used to re-import this shape).
 */
export interface Metrics {
  /** Exact hidden-aware optimal player pours, or a proxy upper bound if the A* overflowed. */
  optimal: number;
  /** Whether `optimal` is the exact A* result (false ⇒ proxy fallback was used). */
  optimalExact: boolean;
  /** 2★ ceiling: the adjusted near-optimal band's upper bound (always `> optimal`). */
  twoStarMax: number;
  /** Fraction of solution-path states with ≤1 useful move. Lower ⇒ more choices ⇒ harder. */
  forcedMoveRatio: number;
  /** Fraction of random playouts that wander into an unrecoverable state. */
  deadEndDensity: number;
  /** Concealment burden (0 for non-hidden boards), size-normalized. */
  digDepth: number;
  /** Funnel load (0 for non-funnel boards): fraction of tubes color-locked, per colors. */
  funnelLoad: number;
  /** Ice load (0 for non-ice boards): fraction of segments that start frozen. */
  iceLoad: number;
  /** Distinct colors on the board (for size normalization). */
  colors: number;
  /** Spare tubes (`bottles - colors`) — the slack budget. */
  empties: number;
}

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
 * Load the whole provenance map (`null` only if the module hasn't been generated yet). Memoized after
 * the first call, and pulled in via a DYNAMIC import so the ~per-level metrics blob lands in its own
 * lazily-fetched chunk — it's only downloaded when an admin actually opens the inspector, never in the
 * main bundle. Access is gated by the hidden admin hatch (the `inspector` setting), not the build mode.
 */
export async function loadProvenance(): Promise<Map<number, LevelProvenance> | null> {
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
