import { describe, it, expect } from 'vitest';
import { canonical, solve, isSolvable, isUnsolvable, search, bfsOptimal } from './solver';
import { isWon, isDeadlocked, legalMoves, pour } from './engine';
import type { GameState, Move } from './types';

const state = (bottles: string[][], capacity = 4): GameState => ({ bottles, capacity });

/** Replay a solution against a state and return the final board. */
function replay(start: GameState, moves: Move[]): GameState {
  return moves.reduce((s, m) => pour(s, m.from, m.to).state, start);
}

describe('canonical', () => {
  it('is order-independent across bottles', () => {
    const a = state([['r', 'g'], ['b'], []]);
    const b = state([[], ['b'], ['r', 'g']]);
    expect(canonical(a)).toBe(canonical(b));
  });

  it('distinguishes genuinely different boards', () => {
    expect(canonical(state([['r', 'g']]))).not.toBe(canonical(state([['g', 'r']])));
  });
});

describe('solve', () => {
  it('returns an empty path for an already-won board', () => {
    expect(solve(state([['r', 'r', 'r', 'r'], []]))).toEqual([]);
  });

  it('solves a simple two-color board and the solution actually wins', () => {
    const s = state([
      ['r', 'g', 'r', 'g'],
      ['g', 'r', 'g', 'r'],
      [],
      [],
    ]);
    const sol = solve(s);
    expect(sol).not.toBeNull();
    expect(isWon(replay(s, sol!))).toBe(true);
  });

  it('returns null for a provably unsolvable board', () => {
    // Two full bottles, interleaved opposite colors, no empties → no legal move at all.
    const stuck = state([
      ['r', 'g', 'r', 'g'],
      ['g', 'r', 'g', 'r'],
    ]);
    expect(solve(stuck)).toBeNull();
    expect(isSolvable(stuck)).toBe(false);
  });

  it('respects the node budget (returns null instead of hanging)', () => {
    const s = state([
      ['r', 'g', 'b', 'y'],
      ['y', 'b', 'g', 'r'],
      ['g', 'r', 'y', 'b'],
      [],
      [],
    ]);
    // With an absurdly tiny budget it must bail rather than loop forever.
    expect(solve(s, { maxNodes: 1 })).toBeNull();
  });
});

describe('isUnsolvable (proof-based deadlock)', () => {
  it('detects a "loop": legal moves exist but the board can never be won', () => {
    // 5 reds + 5 greens with capacity 4 can never form all-mono bottles, yet the top
    // green of bottle 0 can still be poured into the partial bottle 2 — a pointless move.
    const stuck = state([
      ['r', 'g', 'r', 'g'],
      ['g', 'r', 'g', 'r'],
      ['r', 'g'],
    ]);
    // Moves remain, so the old zero-moves check would NOT catch this...
    expect(legalMoves(stuck).length).toBeGreaterThan(0);
    expect(isDeadlocked(stuck)).toBe(false);
    // ...but the solver proves it unsolvable.
    expect(isUnsolvable(stuck)).toBe(true);
  });

  it('catches the zero-legal-moves case too', () => {
    const stuck = state([
      ['r', 'g', 'r', 'g'],
      ['g', 'r', 'g', 'r'],
    ]);
    expect(isUnsolvable(stuck)).toBe(true);
  });

  it('is false for a solvable board', () => {
    const s = state([
      ['r', 'g', 'r', 'g'],
      ['g', 'r', 'g', 'r'],
      [],
      [],
    ]);
    expect(isUnsolvable(s)).toBe(false);
  });

  it('is false for a won board', () => {
    expect(isUnsolvable(state([['r', 'r', 'r', 'r'], []]))).toBe(false);
  });

  it('does NOT declare deadlock when the search is inconclusive (budget hit)', () => {
    // A solvable board, but with a tiny node budget the search can't prove anything —
    // it must report "not unsolvable" so a winnable game is never ended by mistake.
    const s = state([
      ['r', 'g', 'b', 'y'],
      ['y', 'b', 'g', 'r'],
      ['g', 'r', 'y', 'b'],
      [],
      [],
    ]);
    const result = search(s, { maxNodes: 1 });
    expect(result.exhausted).toBe(false);
    expect(isUnsolvable(s, { maxNodes: 1 })).toBe(false);
  });
});

describe('bfsOptimal', () => {
  it('finds the minimum move count', () => {
    // One pour away from solved: the lone g onto the stack of three g's.
    // (4 r's + 4 g's, so both colors can actually complete.)
    const s = state([
      ['r', 'r', 'r', 'r'],
      ['g', 'g', 'g'],
      ['g'],
    ]);
    expect(bfsOptimal(s)).toBe(1);
  });

  it('returns 0 for a solved board', () => {
    expect(bfsOptimal(state([['r', 'r', 'r', 'r'], []]))).toBe(0);
  });
});
