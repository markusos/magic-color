import { describe, it, expect } from 'vitest';
import { assignSlots, compositeScores, digDepth, measureMetrics, type Metrics } from './difficulty';
import { emptyGrid } from './hidden';
import { solve } from './solver';
import { board } from '../test/board';

/** Build a Metrics with sensible defaults so tests only set what they exercise. */
function m(over: Partial<Metrics>): Metrics {
  return {
    optimal: 4,
    optimalExact: true,
    twoStarMax: 6,
    forcedMoveRatio: 0.5,
    deadEndDensity: 0.2,
    digDepth: 0,
    colors: 4,
    empties: 1,
    ...over,
  };
}

describe('measureMetrics', () => {
  it('measures a solvable board across every metric', () => {
    const state = board(
      [
        ['ruby', 'sapphire'],
        ['sapphire', 'ruby'],
        [],
      ],
      2,
    );
    const solution = solve(state)!;
    const metrics = measureMetrics(state, emptyGrid(state), solution, { deadEndSamples: 8 });

    expect(metrics.optimal).toBeGreaterThan(0);
    expect(metrics.optimalExact).toBe(true); // tiny board resolves well within the node budget
    expect(metrics.twoStarMax).toBeGreaterThan(metrics.optimal); // 2★ band sits strictly above optimal
    expect(metrics.forcedMoveRatio).toBeGreaterThanOrEqual(0);
    expect(metrics.forcedMoveRatio).toBeLessThanOrEqual(1);
    expect(metrics.deadEndDensity).toBeGreaterThanOrEqual(0);
    expect(metrics.deadEndDensity).toBeLessThanOrEqual(1);
    expect(metrics.digDepth).toBe(0); // nothing concealed
    expect(metrics.colors).toBe(2);
    expect(metrics.empties).toBe(1); // 3 bottles − 2 colors
  });

  it('is deterministic for a given dead-end seed', () => {
    const state = board([['ruby', 'sapphire'], ['sapphire', 'ruby'], []], 2);
    const solution = solve(state)!;
    const a = measureMetrics(state, emptyGrid(state), solution, { deadEndSamples: 12, deadEndSeed: 7 });
    const b = measureMetrics(state, emptyGrid(state), solution, { deadEndSamples: 12, deadEndSeed: 7 });
    expect(a.deadEndDensity).toBe(b.deadEndDensity);
  });
});

describe('compositeScores', () => {
  it('scores a harder board above an easier one', () => {
    const easy = m({ deadEndDensity: 0.1, forcedMoveRatio: 0.9, optimal: 4, colors: 4, empties: 2 });
    const hard = m({ deadEndDensity: 0.8, forcedMoveRatio: 0.1, optimal: 12, colors: 4, empties: 0 });
    const [se, sh] = compositeScores([easy, hard]);
    expect(sh).toBeGreaterThan(se!);
  });

  it('returns an empty array for an empty pool', () => {
    expect(compositeScores([])).toEqual([]);
  });
});

describe('digDepth', () => {
  it('is 0 with nothing concealed and grows with how buried a "?" is', () => {
    const state = board([['ruby', 'amber', 'teal', 'lime'], []], 4);
    const none = [[false, false, false, false], []];
    const shallow = [[false, false, true, false], []]; // "?" near the top
    const deep = [[true, false, false, false], []]; // "?" at the bottom — more to dig out
    expect(digDepth(state, none)).toBe(0);
    expect(digDepth(state, shallow)).toBeGreaterThan(0);
    expect(digDepth(state, deep)).toBeGreaterThan(digDepth(state, shallow));
  });
});

describe('assignSlots', () => {
  const pool = [
    { score: 0.1, family: 'a' },
    { score: 0.1, family: 'b' },
    { score: 0.5, family: 'a' },
    { score: 0.5, family: 'b' },
  ];

  it('assigns one candidate per slot with non-decreasing score', () => {
    const idx = assignSlots(pool, [0, 0, 1, 1]);
    expect(idx).toHaveLength(4);
    const scores = idx.map((i) => pool[i]!.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]!);
  });

  it('rotates shape families to avoid back-to-back repeats', () => {
    const idx = assignSlots(pool, [0, 0, 1, 1]);
    const families = idx.map((i) => pool[i]!.family);
    for (let i = 1; i < families.length; i++) expect(families[i]).not.toBe(families[i - 1]);
  });

  it('throws when the pool is smaller than the slot count', () => {
    expect(() => assignSlots([{ score: 0.1, family: 'a' }], [0, 1])).toThrow();
  });
});
