import { describe, it, expect } from 'vitest';
import { hintMove, optimalCappedMoves } from './search';
import { emptyGrid } from './hidden';
import { pour } from './engine';
import { board, color } from '../test/board';

/**
 * The hint must surface the first move of an *optimal* continuation from the current board. We verify
 * that by checking the suggested move (a) is a legal pour and (b) leaves the board on the optimal line —
 * i.e. solving from the post-hint board takes exactly one fewer move than from the original.
 */
describe('hintMove', () => {
  it('suggests a legal pour that stays on the optimal line', () => {
    // Two mixed tubes of r and b plus an empty (capacity 2): a small fully-solvable board.
    const state = board([['r', 'b'], ['b', 'r'], []], 2);
    const hidden = emptyGrid(state);
    const optimal = optimalCappedMoves(state, hidden)!;
    expect(optimal).toBeGreaterThan(0);

    const move = hintMove(state, hidden)!;
    expect(move).not.toBeNull();
    // The pour is legal and the post-move board is one step closer to optimal.
    const next = pour(state, move.from, move.to).state;
    expect(optimalCappedMoves(next, emptyGrid(next))).toBe(optimal - 1);
  });

  it('returns null on an already-solved board (nothing to hint)', () => {
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    expect(hintMove(state, emptyGrid(state))).toBeNull();
  });

  it('returns null on a deadlocked board (no continuation)', () => {
    // Two full tubes of clashing colors, no empty: no legal pour exists.
    const state = board([['r', 'b', 'r', 'b'], ['b', 'r', 'b', 'r']], 4);
    expect(hintMove(state, emptyGrid(state))).toBeNull();
  });

  it('honors funnels — never suggests a pour into a tube locked to another color', () => {
    // Same solvable board, but the natural first empty (tube 2) is funnel-locked to green: neither r
    // nor b may pour in, so every suggested pour must target tube 3 instead.
    const state = board([['r', 'b'], ['b', 'r'], [], []], 2);
    const hidden = emptyGrid(state);
    const funnels = [null, null, color('g'), null];
    const move = hintMove(state, hidden, { funnels })!;
    expect(move).not.toBeNull();
    expect(move.to).not.toBe(2);
  });
});
