/**
 * Pure analysis over the committed bake provenance (`scripts/levels.provenance.json`) for the
 * `scripts/level-report.ts` CLI (Track E2). Kept here — typed and unit-tested beside the other game
 * logic — while the CLI stays a thin formatting/IO shell. Nothing here runs in the app or feeds the
 * bake, so it's outside the `levelVersion.ts` hash and never forces a re-bake.
 *
 * Two jobs: summarize a single bake (per-chapter score/metric distributions, family mix, exact-optimal
 * rate, monotonicity slips) so a curve is glanceable; and diff two bakes (which levels moved and by how
 * much) so a `SCORE_WEIGHTS` / `SHAPES` change yields a precise per-level delta instead of eyeballing.
 */
import type { LevelProvenance } from './provenance';

/** The per-board metrics worth aggregating in the report (the size-decoupled "feels hard" signals). */
export const REPORT_METRICS = [
  'deadEndDensity',
  'forcedMoveRatio',
  'digDepth',
  'funnelLoad',
  'iceLoad',
] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

export interface NumStats {
  min: number;
  max: number;
  mean: number;
  median: number;
}

/** Min / max / mean / median of a sample (zeros for an empty sample). */
export function numStats(values: readonly number[]): NumStats {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { min: sorted[0]!, max: sorted[sorted.length - 1]!, mean: sum / sorted.length, median };
}

/** Bucket counts for `values` over `[lo, hi]` split into `buckets` equal bins (out-of-range clamps in). */
export function histogram(values: readonly number[], buckets: number, lo = 0, hi = 1): number[] {
  const counts = new Array<number>(buckets).fill(0);
  if (hi <= lo) return counts;
  for (const v of values) {
    const t = (v - lo) / (hi - lo);
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor(t * buckets)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return counts;
}

/** A level whose difficulty score dips below its predecessor's — the curve should be non-decreasing. */
export interface MonotonicityViolation {
  level: number;
  score: number;
  prevLevel: number;
  prevScore: number;
}

/**
 * Within-chapter monotonicity slips: levels (in level order) whose score is below the prior level's.
 * The bake enforces a non-decreasing curve per chapter but relaxes it when nothing else qualifies, so a
 * slip flags where that relaxation fired. Caller passes one chapter's rows.
 */
export function monotonicityViolations(levels: readonly LevelProvenance[]): MonotonicityViolation[] {
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  const out: MonotonicityViolation[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.score < prev.score) {
      out.push({ level: cur.level, score: cur.score, prevLevel: prev.level, prevScore: prev.score });
    }
  }
  return out;
}

export interface ChapterReport {
  chapter: number;
  firstLevel: number;
  lastLevel: number;
  count: number;
  score: NumStats;
  optimal: NumStats;
  /** Fraction of boards whose `optimal` is the exact A* result (vs. the proxy upper bound). */
  exactRate: number;
  /** Shape-family counts, e.g. `{ small: 3, medium: 7 }`. */
  families: Record<string, number>;
  /** Mean of each {@link REPORT_METRICS} signal across the chapter. */
  metricMeans: Record<ReportMetric, number>;
  monotonicity: MonotonicityViolation[];
}

/** Group provenance rows by chapter and summarize each (ascending chapter order). */
export function buildReport(provs: readonly LevelProvenance[]): ChapterReport[] {
  const byChapter = new Map<number, LevelProvenance[]>();
  for (const p of provs) {
    const list = byChapter.get(p.chapter);
    if (list) list.push(p);
    else byChapter.set(p.chapter, [p]);
  }

  return [...byChapter.keys()]
    .sort((a, b) => a - b)
    .map((chapter) => {
      const levels = [...byChapter.get(chapter)!].sort((a, b) => a.level - b.level);
      const families: Record<string, number> = {};
      for (const p of levels) families[p.family] = (families[p.family] ?? 0) + 1;

      const metricMeans = {} as Record<ReportMetric, number>;
      for (const key of REPORT_METRICS) {
        metricMeans[key] = numStats(levels.map((p) => p.metrics[key])).mean;
      }

      return {
        chapter,
        firstLevel: levels[0]!.level,
        lastLevel: levels[levels.length - 1]!.level,
        count: levels.length,
        score: numStats(levels.map((p) => p.score)),
        optimal: numStats(levels.map((p) => p.metrics.optimal)),
        exactRate: levels.filter((p) => p.metrics.optimalExact).length / levels.length,
        families,
        metricMeans,
        monotonicity: monotonicityViolations(levels),
      };
    });
}

/** One level's change between two bakes (present in both). */
export interface LevelDelta {
  level: number;
  scoreA: number;
  scoreB: number;
  dScore: number;
  optimalA: number;
  optimalB: number;
  dOptimal: number;
  familyA: string;
  familyB: string;
}

export interface ProvenanceDiff {
  /** Levels only in the second bake. */
  added: number[];
  /** Levels only in the first bake. */
  removed: number[];
  /** Levels in both that differ in score, optimal, or family — sorted by |Δscore| descending. */
  changed: LevelDelta[];
  /** Levels in both that are byte-identical on score/optimal/family. */
  unchanged: number;
}

/** Join two bakes by level and report what moved. `a` is the baseline, `b` the new bake. */
export function diffProvenance(a: readonly LevelProvenance[], b: readonly LevelProvenance[]): ProvenanceDiff {
  const aMap = new Map(a.map((p) => [p.level, p]));
  const bMap = new Map(b.map((p) => [p.level, p]));
  const added = [...bMap.keys()].filter((l) => !aMap.has(l)).sort((x, y) => x - y);
  const removed = [...aMap.keys()].filter((l) => !bMap.has(l)).sort((x, y) => x - y);

  const changed: LevelDelta[] = [];
  let unchanged = 0;
  for (const [level, pa] of aMap) {
    const pb = bMap.get(level);
    if (!pb) continue;
    const same =
      pa.score === pb.score && pa.metrics.optimal === pb.metrics.optimal && pa.family === pb.family;
    if (same) {
      unchanged++;
      continue;
    }
    changed.push({
      level,
      scoreA: pa.score,
      scoreB: pb.score,
      dScore: pb.score - pa.score,
      optimalA: pa.metrics.optimal,
      optimalB: pb.metrics.optimal,
      dOptimal: pb.metrics.optimal - pa.metrics.optimal,
      familyA: pa.family,
      familyB: pb.family,
    });
  }
  changed.sort((x, y) => Math.abs(y.dScore) - Math.abs(x.dScore) || x.level - y.level);
  return { added, removed, changed, unchanged };
}
