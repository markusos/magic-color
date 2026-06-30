/**
 * Data layer for the bake report app. Pulls the committed difficulty provenance (the same dev-only
 * module the in-app inspector reads) and parses externally-loaded provenance files for comparison.
 * Analysis itself lives in the shared, unit-tested `src/game/levelReport.ts`.
 */
import { LEVEL_PROVENANCE } from '../src/game/levels.provenance';
import type { LevelProvenance } from '../src/game/provenance';

/** The committed bake's provenance rows, sorted by level. */
export function committedLevels(): LevelProvenance[] {
  return Object.values(LEVEL_PROVENANCE).sort((a, b) => a.level - b.level);
}

/** Parse a dropped/selected provenance file — accepts the `{ version, levels }` wrapper or a bare array. */
export function parseProvenance(text: string): { version?: string; levels: LevelProvenance[] } {
  const parsed: unknown = JSON.parse(text);
  const levels = Array.isArray(parsed)
    ? (parsed as LevelProvenance[])
    : ((parsed as { levels?: LevelProvenance[] }).levels ?? []);
  const version = Array.isArray(parsed) ? undefined : (parsed as { version?: string }).version;
  return { version, levels: [...levels].sort((a, b) => a.level - b.level) };
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
  { key: 'deadEndDensity', label: 'dead-end', color: '#ff5d73', accessor: (p) => p.metrics.deadEndDensity, unit: '01' },
  { key: 'forcedMoveRatio', label: 'forced', color: '#f59e6b', accessor: (p) => p.metrics.forcedMoveRatio, unit: '01' },
  { key: 'digDepth', label: 'dig depth', color: '#9d7cd8', accessor: (p) => p.metrics.digDepth, unit: '01' },
  { key: 'funnelLoad', label: 'funnel', color: '#56b6c2', accessor: (p) => p.metrics.funnelLoad, unit: '01' },
  { key: 'iceLoad', label: 'ice', color: '#7aa2ff', accessor: (p) => p.metrics.iceLoad, unit: '01' },
];

/** Curve target percentile, overlaid on the score chart as the line the bake aimed each slot at. */
export const TARGET_ACCESSOR = (p: LevelProvenance): number => p.targetPercentile;
