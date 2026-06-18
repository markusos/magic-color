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

  it('reports par equal to minMoves in the default (proxy, no floor) path', () => {
    const level = generateLevel({ colors: 5, bottles: 7, seed: 7 });
    expect(level.par).toBe(level.minMoves);
  });

  it('optimal parMode never exceeds the DFS solution length', () => {
    const level = generateLevel({ colors: 4, bottles: 6, seed: 11, parMode: 'optimal' });
    expect(level.par).toBeLessThanOrEqual(level.minMoves);
    expect(level.par).toBeGreaterThan(0);
  });
});

describe('generateLevel par floor', () => {
  it('meets the floor when it is reachable, and stays solvable', () => {
    const level = generateLevel({ colors: 5, bottles: 7, seed: 3, minPar: 8, parMode: 'proxy' });
    expect(level.par).toBeGreaterThanOrEqual(8);
    expect(isWon(replay(level.state, level.solution))).toBe(true);
  });

  it('falls back to the hardest board found when the floor is unreachable', () => {
    // An absurd floor can never be met, but generation must still return a solvable board.
    const level = generateLevel({ colors: 4, bottles: 6, seed: 5, minPar: 10_000 });
    expect(level.par).toBeLessThan(10_000);
    expect(isWon(replay(level.state, level.solution))).toBe(true);
  });

  it('is still reproducible for a fixed seed with a floor', () => {
    const a = generateLevel({ colors: 5, bottles: 7, seed: 21, minPar: 12, parMode: 'optimal' });
    const b = generateLevel({ colors: 5, bottles: 7, seed: 21, minPar: 12, parMode: 'optimal' });
    expect(a.state.bottles).toEqual(b.state.bottles);
    expect(a.par).toBe(b.par);
  });
});

describe('difficulty tiers', () => {
  const tiers: Difficulty[] = ['easy', 'normal', 'hard'];

  it.each(tiers)('createLevel(%s) has fixed tubes, balanced colors, and bounded slack', (tier) => {
    const level = createLevel(tier, 5);
    const preset = TIERS[tier];
    expect(level.bottles).toBe(preset.tubes); // fixed tubes per tier
    expect(level.colors).toBe(preset.tubes - preset.emptyTubes); // colors = tubes - spare
    // Color balance is preserved: each color fills exactly `capacity` segments.
    const counts = new Map<string, number>();
    for (const bottle of level.state.bottles) {
      for (const c of bottle) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect(counts.size).toBe(level.colors);
    for (const n of counts.values()) expect(n).toBe(level.capacity);
    // Free space is a budget, not a literal empty count: at most `emptyTubes` tubes are empty.
    const emptyTubes = level.state.bottles.filter((b) => b.length === 0).length;
    expect(emptyTubes).toBeLessThanOrEqual(preset.emptyTubes);
    expect(isWon(replay(level.state, level.solution))).toBe(true);
  });

  it('scatters empty and partially filled tubes for variety across seeds', () => {
    for (const tier of tiers) {
      const preset = TIERS[tier];
      let sawPartialTube = false;
      let sawFewerThanMaxEmpties = false;
      for (let seed = 0; seed < 30; seed++) {
        const level = createLevel(tier, seed);
        const emptyTubes = level.state.bottles.filter((b) => b.length === 0).length;
        // Empty count never exceeds the tier's free-space budget.
        expect(emptyTubes).toBeLessThanOrEqual(preset.emptyTubes);
        if (emptyTubes < preset.emptyTubes) sawFewerThanMaxEmpties = true;
        if (level.state.bottles.some((b) => b.length > 0 && b.length < level.capacity)) {
          sawPartialTube = true;
        }
      }
      // Both the new behaviors actually occur: half-full tubes, and boards with fewer (or zero)
      // empties than the old full-tubes-plus-empties layout would have produced.
      expect(sawPartialTube).toBe(true);
      expect(sawFewerThanMaxEmpties).toBe(true);
    }
  });

  it('every tier generates a solvable board across many seeds (incl. 15-tube hard)', () => {
    for (const tier of tiers) {
      for (let seed = 0; seed < 12; seed++) {
        const level = createLevel(tier, seed);
        expect(isWon(replay(level.state, level.solution))).toBe(true);
      }
    }
  });
});
