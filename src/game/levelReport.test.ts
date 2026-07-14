import { describe, expect, it } from 'vitest';
import type { LevelProvenance } from './provenance';
import type { Metrics } from './provenance';
import { buildReport, diffProvenance, histogram, monotonicityViolations, numStats } from './levelReport';

interface RowOver {
  level: number;
  chapter?: number;
  family?: string;
  score?: number;
  metrics?: Partial<Metrics>;
}

/** Build a provenance row with sensible defaults; override the bits a test cares about. */
function row(over: RowOver): LevelProvenance {
  const metrics: Metrics = {
    optimal: 10,
    optimalExact: true,
    twoStarMax: 12,
    forcedMoveRatio: 0,
    deadEndDensity: 0,
    digDepth: 0,
    funnelLoad: 0,
    iceLoad: 0,
    colors: 4,
    empties: 1,
    ...over.metrics,
  };
  return {
    level: over.level,
    chapter: over.chapter ?? 0,
    phase: 'easy',
    family: over.family ?? 'small',
    footprint: '4c/5b×4',
    targetPercentile: 0.5,
    score: over.score ?? 0.4,
    metrics,
  };
}

describe('numStats', () => {
  it('computes min/max/mean/median', () => {
    expect(numStats([1, 2, 3, 4])).toEqual({ min: 1, max: 4, mean: 2.5, median: 2.5 });
    expect(numStats([5, 1, 3])).toEqual({ min: 1, max: 5, mean: 3, median: 3 });
  });

  it('is all-zero for an empty sample', () => {
    expect(numStats([])).toEqual({ min: 0, max: 0, mean: 0, median: 0 });
  });
});

describe('histogram', () => {
  it('buckets values, clamping the top edge into the last bucket', () => {
    // 4 buckets over [0,1]: 0.0–0.25, 0.25–0.5, 0.5–0.75, 0.75–1.0 (incl. exactly 1.0).
    expect(histogram([0, 0.1, 0.3, 0.9, 1], 4)).toEqual([2, 1, 0, 2]);
  });
});

describe('monotonicityViolations', () => {
  it('flags a level whose score dips below the previous one', () => {
    const v = monotonicityViolations([
      row({ level: 1, score: 0.3 }),
      row({ level: 2, score: 0.32 }),
      row({ level: 3, score: 0.31 }), // dip
      row({ level: 4, score: 0.5 }),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ level: 3, prevLevel: 2, score: 0.31, prevScore: 0.32 });
  });

  it('returns nothing for a non-decreasing curve', () => {
    expect(
      monotonicityViolations([row({ level: 1, score: 0.2 }), row({ level: 2, score: 0.2 })]),
    ).toHaveLength(0);
  });
});

describe('buildReport', () => {
  it('groups by chapter and summarizes score, families, and exact rate', () => {
    const report = buildReport([
      row({ level: 1, chapter: 0, family: 'small', score: 0.3, metrics: { optimalExact: true } }),
      row({ level: 2, chapter: 0, family: 'small', score: 0.5, metrics: { optimalExact: false } }),
      row({ level: 61, chapter: 1, family: 'large', score: 0.6 }),
    ]);
    expect(report).toHaveLength(2);

    const ch0 = report[0]!;
    expect(ch0.chapter).toBe(0);
    expect(ch0.count).toBe(2);
    expect(ch0.firstLevel).toBe(1);
    expect(ch0.lastLevel).toBe(2);
    expect(ch0.score.mean).toBeCloseTo(0.4);
    expect(ch0.families).toEqual({ small: 2 });
    expect(ch0.exactRate).toBe(0.5);

    expect(report[1]!.chapter).toBe(1);
  });
});

describe('diffProvenance', () => {
  const a = [row({ level: 1, score: 0.3 }), row({ level: 2, score: 0.4 }), row({ level: 3, score: 0.5 })];

  it('reports added, removed, and changed levels sorted by |Δscore|', () => {
    const b = [
      row({ level: 1, score: 0.3 }), // unchanged
      row({ level: 2, score: 0.55 }), // +0.15
      // level 3 removed
      row({ level: 4, score: 0.7 }), // added
    ];
    const diff = diffProvenance(a, b);
    expect(diff.added).toEqual([4]);
    expect(diff.removed).toEqual([3]);
    expect(diff.unchanged).toBe(1);
    expect(diff.changed.map((c) => c.level)).toEqual([2]);
    expect(diff.changed[0]!.dScore).toBeCloseTo(0.15);
  });

  it('orders changed levels by the magnitude of the score move', () => {
    const b = [
      row({ level: 1, score: 0.35 }), // +0.05
      row({ level: 2, score: 0.1 }), // -0.30 (biggest)
      row({ level: 3, score: 0.52 }), // +0.02
    ];
    expect(diffProvenance(a, b).changed.map((c) => c.level)).toEqual([2, 1, 3]);
  });

  it('treats a same-score/optimal/family row as unchanged even if other metrics differ', () => {
    const b = [row({ level: 1, score: 0.3, metrics: { deadEndDensity: 0.9 } })];
    const diff = diffProvenance([row({ level: 1, score: 0.3 })], b);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });
});
