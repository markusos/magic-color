/**
 * Computes the largest bottle size that fits ALL tubes inside the available board area
 * without scrolling, using a FIXED number of columns. With 5 columns and the tier tube
 * counts (5 / 10 / 15) this yields exactly 1 / 2 / 3 rows. Re-measures via ResizeObserver
 * so it adapts to any phone size.
 */
import { useEffect, useState, type RefObject } from 'react';

/** Tubes per row — gives 1/2/3 rows for the 5/10/15-tube tiers. */
export const TUBES_PER_ROW = 5;

export interface BottleMetrics {
  /** Bottle width in px (also drives every other dimension). */
  width: number;
  /** Height of one liquid segment in px. */
  segmentHeight: number;
  columns: number;
  colGap: number;
  rowGap: number;
}

// Geometry constants, all expressed relative to bottle width so everything scales.
const SEG_ASPECT = 0.72; // segment height / bottle width
const NECK_FACTOR = 0.4; // extra bottle height (neck/base) as a multiple of one segment
const COL_GAP_F = 0.34; // column gap / width
// Row gap / width. Must clear the selection lift (segmentHeight*0.7 = 0.5*width) plus the tilt's
// extra rise and the spring overshoot, or a selected lower-row tube pokes into the row above.
const ROW_GAP_F = 0.72;
const LIFT_ROOM_F = 0.5; // headroom above the top row for the lifted/selected bottle
const MIN_WIDTH = 20;
// Upper clamp on tube width. Phones are always width-bound well below this (5 tubes across a ~360px
// row is ~56px each), so this only bites on WIDE screens (desktop / tablet), where the old 88px cap
// left the board a small column stranded in a large field. Raising it lets the board grow to fill
// more of a big viewport (still bounded by wByHeight, so tall boards never overflow). U4.
const MAX_WIDTH = 120;

/** bottle height as a multiple of width, for a given capacity. */
function heightFactor(capacity: number): number {
  return SEG_ASPECT * (capacity + NECK_FACTOR);
}

/**
 * Pure layout solver — exported for unit testing. Lays the tubes out in `columns`
 * columns (clamped to the tube count) and sizes the bottle so the whole grid fits the
 * area in both dimensions.
 */
export function computeMetrics(
  areaW: number,
  areaH: number,
  count: number,
  capacity: number,
  columns: number,
): BottleMetrics {
  const cols = Math.max(1, Math.min(columns, count));
  if (areaW <= 0 || areaH <= 0 || count <= 0) {
    return {
      width: MIN_WIDTH,
      segmentHeight: MIN_WIDTH * SEG_ASPECT,
      columns: cols,
      colGap: MIN_WIDTH * COL_GAP_F,
      rowGap: MIN_WIDTH * ROW_GAP_F,
    };
  }

  const rows = Math.ceil(count / cols);
  const hf = heightFactor(capacity);
  const wByWidth = areaW / (cols + COL_GAP_F * (cols - 1));
  const wByHeight = areaH / (rows * hf + ROW_GAP_F * (rows - 1) + LIFT_ROOM_F);
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.min(wByWidth, wByHeight)));

  return {
    width,
    segmentHeight: width * SEG_ASPECT,
    columns: cols,
    colGap: width * COL_GAP_F,
    rowGap: width * ROW_GAP_F,
  };
}

export function useBottleMetrics(
  ref: RefObject<HTMLElement | null>,
  count: number,
  capacity: number,
  columns: number = TUBES_PER_ROW,
): BottleMetrics {
  const [metrics, setMetrics] = useState<BottleMetrics>(() =>
    computeMetrics(360, 480, count, capacity, columns),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setMetrics(computeMetrics(el.clientWidth, el.clientHeight, count, capacity, columns));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, count, capacity, columns]);

  return metrics;
}
