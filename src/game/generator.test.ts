import { describe, it, expect } from 'vitest';
import { generateLevel, isValidCombo, mulberry32 } from './generator';
import { createLevel, TIERS } from './levels';
import { isWon, pour } from './engine';
import { isSolvable } from './solver';
import type { Difficulty, GameState, Move } from './types';

function replay(start: GameState, moves: Move[]): GameState {
  return moves.reduce((s, m) => pour(s, m.from, m.to).state, start);
}

describe('isValidCombo', () => {
  it('requires at least one empty and a sane color count', () => {
    expect(isValidCombo(4, 6)).toBe(true); // 2 empties
    expect(isValidCombo(4, 5)).toBe(true); // 1 empty
    expect(isValidCombo(10, 15)).toBe(true); // 5 empties (15-tube super hard)
    expect(isValidCombo(4, 4)).toBe(false); // 0 empties
    expect(isValidCombo(1, 3)).toBe(false); // too few colors
    expect(isValidCombo(13, 15)).toBe(false); // too many colors (palette is 12)
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('generateLevel', () => {
  it('throws on an invalid combo', () => {
    expect(() => generateLevel({ colors: 4, bottles: 4 })).toThrow();
  });

  it('produces a board with the right shape and a balanced color count', () => {
    const level = generateLevel({ colors: 5, bottles: 7, seed: 123 });
    expect(level.bottles).toBe(7);
    expect(level.state.bottles).toHaveLength(7);
    const counts = new Map<string, number>();
    for (const bottle of level.state.bottles) {
      for (const c of bottle) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect(counts.size).toBe(5);
    for (const n of counts.values()) expect(n).toBe(4);
  });

  it('is reproducible for a fixed seed', () => {
    const a = generateLevel({ colors: 6, bottles: 8, seed: 999 });
    const b = generateLevel({ colors: 6, bottles: 8, seed: 999 });
    expect(a.state.bottles).toEqual(b.state.bottles);
    expect(a.minMoves).toBe(b.minMoves);
  });

  it('the stored solution actually solves the board', () => {
    const level = generateLevel({ colors: 5, bottles: 7, seed: 7 });
    expect(level.solution.length).toBe(level.minMoves);
    expect(isWon(replay(level.state, level.solution))).toBe(true);
  });

  // The core guarantee: no unsolvable levels, ever.
  it('GUARANTEE: every generated level across many seeds is solvable', () => {
    for (let seed = 0; seed < 40; seed++) {
      const level = generateLevel({ colors: 5, bottles: 7, seed });
      expect(isWon(replay(level.state, level.solution))).toBe(true);
      expect(isSolvable(level.state)).toBe(true);
    }
  });
});

describe('difficulty tiers', () => {
  const tiers: Difficulty[] = ['easy', 'normal', 'hard'];

  it.each(tiers)('createLevel(%s) yields a solvable board with the tier tube count', (tier) => {
    const level = createLevel(tier, 5);
    const preset = TIERS[tier];
    expect(level.bottles).toBe(preset.tubes); // fixed tubes per tier
    expect(level.colors).toBeGreaterThanOrEqual(preset.colorsMin);
    expect(level.colors).toBeLessThanOrEqual(preset.colorsMax); // flexible colors, in range
    expect(isWon(replay(level.state, level.solution))).toBe(true);
  });

  it('keeps colors flexible across seeds (varies within the tier range)', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 30; seed++) counts.add(createLevel('normal', seed).colors);
    // normal allows 7–8 colors; across many seeds we should see more than one value.
    expect(counts.size).toBeGreaterThan(1);
  });

  it('every tier generates a solvable board across many seeds (incl. 15-tube super hard)', () => {
    for (const tier of tiers) {
      for (let seed = 0; seed < 12; seed++) {
        const level = createLevel(tier, seed);
        expect(isWon(replay(level.state, level.solution))).toBe(true);
      }
    }
  });
});
