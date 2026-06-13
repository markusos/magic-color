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
  it('requires 1–2 empties and a sane color count', () => {
    expect(isValidCombo(4, 6)).toBe(true); // 2 empties
    expect(isValidCombo(4, 5)).toBe(true); // 1 empty
    expect(isValidCombo(4, 4)).toBe(false); // 0 empties
    expect(isValidCombo(4, 7)).toBe(false); // 3 empties
    expect(isValidCombo(1, 3)).toBe(false); // too few colors
    expect(isValidCombo(13, 15)).toBe(false); // too many colors
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
  const tiers: Difficulty[] = ['normal', 'hard', 'superHard'];
  it.each(tiers)('createLevel(%s) yields a solvable board', (tier) => {
    const level = createLevel(tier, 5);
    const preset = TIERS[tier];
    expect(level.colors).toBe(preset.colors);
    expect(level.bottles).toBe(preset.colors + preset.empties);
    expect(isWon(replay(level.state, level.solution))).toBe(true);
  });
});
