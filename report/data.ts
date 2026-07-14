/**
 * Data layer for the bake report app. Pulls the committed difficulty provenance (the same dev-only
 * module the in-app inspector reads), the archived per-build-hash history under
 * `scripts/build-history/` (so past bakes can be compared side by side), and parses externally-loaded
 * provenance files. Analysis itself lives in the shared, unit-tested `src/game/levelReport.ts`.
 */
import { LEVEL_PROVENANCE } from '../src/game/levels.provenance';
import { GENERATOR_VERSION } from '../src/game/levels.meta';
import type { LevelProvenance } from '../src/game/provenance';
import { buildReport, numStats } from '../src/game/levelReport';

/** A selectable bake: its provenance rows plus the metadata we key/label/order builds by. */
export interface Build {
  /** Stable identity for selection — the generator hash for real bakes, or `file:<name>` for a drop. */
  id: string;
  label: string;
  version?: string;
  count?: number;
  perShape?: number;
  archivedAt?: string;
  /** True for the bake currently committed to `src/game/levels.provenance.ts`. */
  committed?: boolean;
  levels: LevelProvenance[];
}

interface ProvenanceFile {
  version?: string;
  count?: number;
  perShape?: number;
  archivedAt?: string;
  levels: LevelProvenance[];
}

/** Coerce a parsed provenance blob (wrapped `{ version, levels }` or a bare array) into a normal shape. */
function normalize(parsed: unknown): ProvenanceFile {
  if (Array.isArray(parsed)) {
    const levels = parsed as LevelProvenance[];
    return { levels: [...levels].sort((a, b) => a.level - b.level) };
  }
  const obj = parsed as ProvenanceFile;
  return { ...obj, levels: [...(obj.levels ?? [])].sort((a, b) => a.level - b.level) };
}

/** The committed bake's provenance rows, sorted by level. */
export function committedLevels(): LevelProvenance[] {
  return Object.values(LEVEL_PROVENANCE).sort((a, b) => a.level - b.level);
}

/**
 * Every available build for the pickers: the committed bake plus each archived history file
 * (`scripts/build-history/*.json`), newest first. If an archived file shares the committed hash it is
 * flagged as committed rather than duplicated.
 */
export function availableBuilds(): Build[] {
  const modules = import.meta.glob<ProvenanceFile>('../scripts/build-history/*.json', {
    eager: true,
    import: 'default',
  });

  const archived: Build[] = Object.entries(modules).map(([path, raw]) => {
    const file = normalize(raw);
    const hash = path.replace(/^.*\/(.+)\.json$/, '$1');
    const version = file.version ?? hash;
    return {
      id: version,
      label: version.slice(0, 10),
      version,
      count: file.count ?? file.levels.length,
      perShape: file.perShape,
      archivedAt: file.archivedAt,
      committed: version === GENERATOR_VERSION,
      levels: file.levels,
    };
  });
  archived.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));

  // Guarantee the committed bake is present even if the history folder wasn't seeded for it.
  if (!archived.some((b) => b.committed)) {
    archived.unshift({
      id: GENERATOR_VERSION,
      label: GENERATOR_VERSION.slice(0, 10),
      version: GENERATOR_VERSION,
      committed: true,
      levels: committedLevels(),
    });
  }
  return archived;
}

/** Parse a dropped/selected provenance file into a Build (accepts the wrapper or a bare array). */
export function buildFromFile(name: string, text: string): Build {
  const file = normalize(JSON.parse(text));
  return {
    id: `file:${name}`,
    label: name,
    version: file.version,
    count: file.count ?? file.levels.length,
    perShape: file.perShape,
    levels: file.levels,
  };
}

/** Glanceable, whole-campaign aggregates for the builds-overview table. */
export interface BuildSummary {
  levels: number;
  score: { min: number; mean: number; max: number };
  meanOptimal: number;
  exactRate: number;
  /** Total monotonicity slips across all chapters (fewer is better). */
  slips: number;
}

export function summarize(levels: LevelProvenance[]): BuildSummary {
  const score = numStats(levels.map((p) => p.score));
  const slips = buildReport(levels).reduce((n, c) => n + c.monotonicity.length, 0);
  return {
    levels: levels.length,
    score: { min: score.min, mean: score.mean, max: score.max },
    meanOptimal: numStats(levels.map((p) => p.metrics.optimal)).mean,
    exactRate: levels.length ? levels.filter((p) => p.metrics.optimalExact).length / levels.length : 0,
    slips,
  };
}

/** One plottable metric: how to read it off a row, its colour, and whether it lives in [0,1] or is a count. */
export interface MetricDef {
  key: string;
  label: string;
  color: string;
  accessor: (p: LevelProvenance) => number;
  /** `'01'` ⇒ fixed 0–1 axis; `'count'` ⇒ axis scaled to the data max. */
  unit: '01' | 'count';
}

export const METRICS: MetricDef[] = [
  { key: 'score', label: 'score', color: '#ffd166', accessor: (p) => p.score, unit: '01' },
  { key: 'optimal', label: 'optimal', color: '#4ade80', accessor: (p) => p.metrics.optimal, unit: 'count' },
  {
    key: 'deadEndDensity',
    label: 'dead-end',
    color: '#ff5d73',
    accessor: (p) => p.metrics.deadEndDensity,
    unit: '01',
  },
  {
    key: 'forcedMoveRatio',
    label: 'forced',
    color: '#f59e6b',
    accessor: (p) => p.metrics.forcedMoveRatio,
    unit: '01',
  },
  { key: 'digDepth', label: 'dig depth', color: '#9d7cd8', accessor: (p) => p.metrics.digDepth, unit: '01' },
  { key: 'funnelLoad', label: 'funnel', color: '#56b6c2', accessor: (p) => p.metrics.funnelLoad, unit: '01' },
  { key: 'iceLoad', label: 'ice', color: '#7aa2ff', accessor: (p) => p.metrics.iceLoad, unit: '01' },
];

/** Curve target percentile, overlaid on the score chart as the line the bake aimed each slot at. */
export const TARGET_ACCESSOR = (p: LevelProvenance): number => p.targetPercentile;
