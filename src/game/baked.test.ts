import { describe, it, expect } from 'vitest';
import { currentGeneratorVersion } from '../../scripts/levelVersion';
import { BAKED_LEVELS, GENERATOR_VERSION } from './levels.data';
import { chapterForLevel, mechanicsForLevel, phaseForLevel, SHAPES } from './progression';
import { isSolvable } from './solver';
import { board } from '../test/board';

/** Levels we expect to have baked (chapters 0 + 1). Keep in sync with `npm run build:levels`. */
const EXPECTED_COUNT = 60;

describe('baked levels', () => {
  it('is up to date with the generator (re-run `npm run build:levels` if this fails)', () => {
    expect(GENERATOR_VERSION).toBe(currentGeneratorVersion());
  });

  it('covers a contiguous 1..N campaign', () => {
    expect(BAKED_LEVELS).toHaveLength(EXPECTED_COUNT);
    expect(BAKED_LEVELS.map((l) => l.level)).toEqual(
      Array.from({ length: EXPECTED_COUNT }, (_, i) => i + 1),
    );
  });

  it('is well-formed, solvable, and uses a defined shape with correct labels', () => {
    for (const baked of BAKED_LEVELS) {
      // Mechanics + phase are pure functions of the level (difficulty-first labeling).
      expect(baked.mechanics).toEqual([...mechanicsForLevel(baked.level)]);
      expect(baked.phase).toBe(phaseForLevel(baked.level));

      // Color balance: each color fills exactly `capacity` cells.
      const counts = new Map<string, number>();
      for (const col of baked.bottles) for (const c of col) counts.set(c, (counts.get(c) ?? 0) + 1);
      for (const n of counts.values()) expect(n).toBe(baked.capacity);

      // Footprint is one of the defined shapes (so tall tubes only appear on 5-tube boards).
      const colors = counts.size;
      expect(
        SHAPES.some(
          (s) => s.colors === colors && s.bottles === baked.bottles.length && s.capacity === baked.capacity,
        ),
      ).toBe(true);

      // Concealment overlay is shaped to the board; chapter 0 conceals nothing.
      expect(baked.hidden).toHaveLength(baked.bottles.length);
      baked.hidden.forEach((col, i) => expect(col).toHaveLength(baked.bottles[i]!.length));
      if (!mechanicsForLevel(baked.level).includes('hidden')) {
        expect(baked.hidden.every((col) => col.every((x) => !x))).toBe(true);
      }

      expect(baked.optimal).toBeGreaterThan(0);
      expect(baked.twoStarMax).toBeGreaterThan(baked.optimal); // 2★ band sits strictly above optimal
      expect(isSolvable(board(baked.bottles, baked.capacity))).toBe(true);
    }
  });

  it('labels difficulty non-decreasingly within each chapter', () => {
    const rank = { easy: 0, normal: 1, hard: 2 } as const;
    for (let i = 1; i < BAKED_LEVELS.length; i++) {
      const prev = BAKED_LEVELS[i - 1]!;
      const cur = BAKED_LEVELS[i]!;
      if (chapterForLevel(cur.level) === chapterForLevel(prev.level)) {
        expect(rank[cur.phase]).toBeGreaterThanOrEqual(rank[prev.phase]);
      }
    }
  });
});
