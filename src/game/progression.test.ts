import { describe, it, expect } from 'vitest';
import { CHAPTER_LEN, generateForLevel, planForLevel, seedForLevel } from './progression';
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

describe('planForLevel', () => {
  it('starts on the easy rung and is a total function from level 1 up', () => {
    const first = planForLevel(1);
    expect(first.phase).toBe('easy');
    expect(first.colors).toBe(3);
    expect(first.bottles).toBe(5);
    expect(first.chapter).toBe(0);
  });

  it('ramps the footprint upward as levels increase, ending at the hard cap', () => {
    const early = planForLevel(1);
    const top = planForLevel(CHAPTER_LEN); // last level of chapter 0
    expect(top.colors).toBeGreaterThan(early.colors);
    expect(top.bottles).toBeGreaterThan(early.bottles);
    expect(top.phase).toBe('hard');
    expect(top.colors).toBe(12);
    expect(top.bottles).toBe(15);
  });

  it('starts chapter 1 (hidden colors) at level 31, back on the easy rung', () => {
    const last0 = planForLevel(CHAPTER_LEN); // level 30
    expect(last0.chapter).toBe(0);
    expect(last0.mechanics).not.toContain('hidden');

    const first1 = planForLevel(CHAPTER_LEN + 1); // level 31
    expect(first1.chapter).toBe(1);
    expect(first1.phase).toBe('easy');
    expect(first1.colors).toBe(3);
    expect(first1.mechanics).toContain('hidden');
  });

  it('plateaus at the last defined chapter past its end (no demotion)', () => {
    // Chapters 0 and 1 are defined, so deep levels stay in chapter 1 at hard with hidden on.
    const deep = planForLevel(CHAPTER_LEN * 5 + 3);
    expect(deep.chapter).toBe(1);
    expect(deep.phase).toBe('hard');
    expect(deep.colors).toBe(12);
    expect(deep.mechanics).toContain('hidden');
    // ...but each level still gets a distinct seed, so boards stay fresh.
    expect(deep.seed).toBe(seedForLevel(CHAPTER_LEN * 5 + 3));
    expect(deep.seed).not.toBe(planForLevel(CHAPTER_LEN * 5 + 4).seed);
  });

  it('steps difficulty every 5 levels: easy 1-10, normal 11-20, hard 21-30', () => {
    const phaseAt = (level: number) => planForLevel(level).phase;
    // Phase boundaries.
    for (let l = 1; l <= 10; l++) expect(phaseAt(l)).toBe('easy');
    for (let l = 11; l <= 20; l++) expect(phaseAt(l)).toBe('normal');
    for (let l = 21; l <= 30; l++) expect(phaseAt(l)).toBe('hard');
    // The footprint steps up at each 5-level rung boundary (colors strictly increase).
    const colorsAt = (level: number) => planForLevel(level).colors;
    expect([colorsAt(1), colorsAt(6), colorsAt(11), colorsAt(16), colorsAt(21), colorsAt(26)]).toEqual(
      [3, 4, 7, 8, 11, 12],
    );
    // Next chapter rolls over at 31, back to easy but with the hidden mechanic layered on.
    expect(planForLevel(31).phase).toBe('easy');
    expect(planForLevel(31).chapter).toBe(1);
    expect(planForLevel(31).mechanics).toContain('hidden');
  });

  it('uses exact par for easy/normal and the cheap proxy for hard', () => {
    expect(planForLevel(1).parMode).toBe('optimal'); // easy
    expect(planForLevel(CHAPTER_LEN).parMode).toBe('proxy'); // hard
  });
});

describe('generateForLevel', () => {
  it('produces a solvable, correctly-shaped board for sampled levels', () => {
    for (const level of [1, 20, 40, 70, 100, CHAPTER_LEN]) {
      const lvl = generateForLevel(level);
      const plan = planForLevel(level);
      expect(lvl.bottles).toBe(plan.bottles);
      expect(lvl.phase).toBe(plan.phase);
      expect(lvl.level).toBe(level);
      expect(isWon(replay(lvl.state, lvl.solution))).toBe(true);
    }
  });

  it('is reproducible: the same level regenerates the same board', () => {
    const a = generateForLevel(42);
    const b = generateForLevel(42);
    expect(a.state.bottles).toEqual(b.state.bottles);
    expect(a.par).toBe(b.par);
  });

  it('conceals cells only in hidden chapters', () => {
    const anyHidden = (g: boolean[][]) => g.some((col) => col.some(Boolean));
    expect(anyHidden(generateForLevel(1).hidden)).toBe(false); // chapter 0 — no concealment
    expect(anyHidden(generateForLevel(75).hidden)).toBe(true); // chapter 1 — hidden colors
  });
});
