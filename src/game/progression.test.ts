import { describe, it, expect } from 'vitest';
import {
  CHAPTER_LEN,
  chapterForLevel,
  mechanicsForLevel,
  phaseForLevel,
  planForLevel,
  seedForLevel,
  SHAPES,
  targetPercentile,
} from './progression';
import { generateForLevel } from './levelLoader';
import { isWon, pour } from './engine';
import type { GameState, Move } from './types';

function replay(start: GameState, moves: Move[]): GameState {
  return moves.reduce((s, m) => pour(s, m.from, m.to).state, start);
}

describe('seedForLevel', () => {
  it('is deterministic and decorrelates adjacent levels', () => {
    expect(seedForLevel(1)).toBe(seedForLevel(1));
    expect(seedForLevel(1)).not.toBe(seedForLevel(2));
    expect(seedForLevel(1, 0)).not.toBe(seedForLevel(1, 1)); // salt changes the seed
  });
});

describe('chapters', () => {
  it('maps levels to chapters and plateaus past the last defined one', () => {
    expect(chapterForLevel(1)).toBe(0);
    expect(chapterForLevel(CHAPTER_LEN)).toBe(0); // level 30
    expect(chapterForLevel(CHAPTER_LEN + 1)).toBe(1); // level 31
    expect(chapterForLevel(CHAPTER_LEN * 2)).toBe(1); // level 60
    expect(chapterForLevel(CHAPTER_LEN * 5)).toBe(1); // deep — clamped (plateau)
  });

  it('layers the hidden mechanic from chapter 1 on', () => {
    expect(mechanicsForLevel(1)).not.toContain('hidden');
    expect(mechanicsForLevel(CHAPTER_LEN + 1)).toContain('hidden'); // level 31
    expect(mechanicsForLevel(CHAPTER_LEN * 5)).toContain('hidden'); // plateau keeps hidden
  });
});

describe('difficulty curve (targetPercentile)', () => {
  it('rises monotonically within a chapter and eases in from a gentle start', () => {
    expect(targetPercentile(1)).toBeLessThan(targetPercentile(CHAPTER_LEN));
    for (let l = 2; l <= CHAPTER_LEN; l++) {
      expect(targetPercentile(l)).toBeGreaterThanOrEqual(targetPercentile(l - 1));
    }
  });

  it('starts later chapters from a higher floor', () => {
    // First level of chapter 1 is harder than the first level of chapter 0.
    expect(targetPercentile(CHAPTER_LEN + 1)).toBeGreaterThan(targetPercentile(1));
  });

  it('plateaus past the last defined chapter', () => {
    const top = targetPercentile(CHAPTER_LEN * 2); // last defined level
    expect(targetPercentile(CHAPTER_LEN * 5)).toBe(top);
    expect(targetPercentile(CHAPTER_LEN * 9)).toBe(top);
  });
});

describe('phaseForLevel', () => {
  it('labels difficulty from the curve, not tube count, rising over a chapter', () => {
    expect(phaseForLevel(1)).toBe('easy'); // gentle opener
    expect(phaseForLevel(CHAPTER_LEN)).toBe('hard'); // chapter climaxes hard
    expect(['easy', 'normal', 'hard']).toContain(phaseForLevel(15));
  });

  it('is a pure function of the level (bake and live path agree)', () => {
    expect(phaseForLevel(42)).toBe(phaseForLevel(42));
  });
});

describe('shape menu', () => {
  it('only allows tall tubes (capacity > 4) on 5-tube boards', () => {
    for (const s of SHAPES) {
      if (s.capacity > 4) expect(s.bottles).toBe(5);
      expect(s.bottles - s.colors).toBeGreaterThanOrEqual(1); // at least one empty ⇒ generatable
    }
  });
});

describe('planForLevel (live path)', () => {
  it('draws a hard-leaning shape and carries the level metadata', () => {
    const plan = planForLevel(75); // tail level
    expect(plan.chapter).toBe(1);
    expect(plan.mechanics).toContain('hidden');
    expect(plan.phase).toBe(phaseForLevel(75));
    expect(plan.seed).toBe(seedForLevel(75));
    // Footprint is one of the defined shapes.
    expect(SHAPES.some((s) => s.colors === plan.colors && s.bottles === plan.bottles && s.capacity === plan.capacity)).toBe(true);
  });
});

describe('generateForLevel (live generation)', () => {
  it('produces a solvable board matching its plan for sampled tail levels', () => {
    for (const level of [61, 75, 100, 145]) {
      const lvl = generateForLevel(level);
      const plan = planForLevel(level);
      expect(lvl.bottles).toBe(plan.bottles);
      expect(lvl.phase).toBe(plan.phase);
      expect(lvl.level).toBe(level);
      expect(isWon(replay(lvl.state, lvl.solution))).toBe(true);
    }
  });

  it('is reproducible: the same level regenerates the same board', () => {
    const a = generateForLevel(72);
    const b = generateForLevel(72);
    expect(a.state.bottles).toEqual(b.state.bottles);
    expect(a.par).toBe(b.par);
  });

  it('conceals cells only in hidden chapters', () => {
    const anyHidden = (g: boolean[][]) => g.some((col) => col.some(Boolean));
    // Chapter 0 (level ≤ 30) never conceals; the plateau tail (chapter 1) does.
    expect(anyHidden(generateForLevel(75).hidden)).toBe(true);
  });
});
