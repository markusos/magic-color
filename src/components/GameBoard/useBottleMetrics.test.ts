import { describe, it, expect } from 'vitest';
import { computeMetrics, TUBES_PER_ROW } from './useBottleMetrics';

// A representative small phone board area (after header/toolbar/safe-areas).
const AREA_W = 360;
const AREA_H = 540;
const CAP = 4;
const COLS = TUBES_PER_ROW;
// Matches NECK_FACTOR in the layout solver (bottle height = segments + neck/base).
const NECK_FACTOR = 0.4;

describe('computeMetrics (fixed-column, no-scroll layout)', () => {
  // 5 tubes -> 1 row, 10 -> 2 rows, 15 -> 3 rows.
  it.each([
    [5, 1],
    [10, 2],
    [15, 3],
  ])('lays %d tubes into the expected rows', (count, expectedRows) => {
    const m = computeMetrics(AREA_W, AREA_H, count, CAP, COLS);
    expect(m.columns).toBe(Math.min(COLS, count));
    expect(Math.ceil(count / m.columns)).toBe(expectedRows);
  });

  it.each([5, 10, 15])('fits %d tubes within the area width and height', (count) => {
    const m = computeMetrics(AREA_W, AREA_H, count, CAP, COLS);
    const rows = Math.ceil(count / m.columns);

    const gridWidth = m.columns * m.width + (m.columns - 1) * m.colGap;
    expect(gridWidth).toBeLessThanOrEqual(AREA_W + 0.5);

    const bottleHeight = m.segmentHeight * (CAP + NECK_FACTOR);
    const gridHeight = rows * bottleHeight + (rows - 1) * m.rowGap;
    // Conservative — the solver also reserves headroom for the selection lift.
    expect(gridHeight).toBeLessThanOrEqual(AREA_H + 0.5);
  });

  it('shrinks bottles as the tube count (rows) grows', () => {
    const w5 = computeMetrics(AREA_W, AREA_H, 5, CAP, COLS).width;
    const w10 = computeMetrics(AREA_W, AREA_H, 10, CAP, COLS).width;
    const w15 = computeMetrics(AREA_W, AREA_H, 15, CAP, COLS).width;
    expect(w5).toBeGreaterThanOrEqual(w10);
    expect(w10).toBeGreaterThanOrEqual(w15);
  });

  it('keeps 15 tubes reasonably tappable on a phone', () => {
    expect(computeMetrics(AREA_W, AREA_H, 15, CAP, COLS).width).toBeGreaterThan(24);
  });

  it('degrades gracefully for a zero-sized area', () => {
    const m = computeMetrics(0, 0, 15, CAP, COLS);
    expect(m.width).toBeGreaterThan(0);
    expect(m.columns).toBe(COLS);
  });
});
