import { describe, it, expect } from 'vitest';
import {
  topColor,
  topRunLength,
  freeSpace,
  isComplete,
  canPour,
  pourAmount,
  pour,
  isWon,
  legalMoves,
  isDeadlocked,
} from './engine';
import { board as state, color, tube } from '../test/board';

describe('inspection helpers', () => {
  it('topColor returns the last segment or null', () => {
    expect(topColor(tube(['r', 'g', 'b']))).toBe(color('b'));
    expect(topColor(tube([]))).toBeNull();
  });

  it('topRunLength counts the contiguous top color', () => {
    expect(topRunLength(tube(['r', 'g', 'g', 'g']))).toBe(3);
    expect(topRunLength(tube(['r', 'g', 'b']))).toBe(1);
    expect(topRunLength(tube([]))).toBe(0);
    expect(topRunLength(tube(['b', 'b', 'b', 'b']))).toBe(4);
  });

  it('freeSpace accounts for capacity', () => {
    expect(freeSpace(tube(['r', 'g']), 4)).toBe(2);
    expect(freeSpace(tube([]), 4)).toBe(4);
    expect(freeSpace(tube(['r', 'g', 'b', 'y']), 4)).toBe(0);
  });

  it('isComplete is true for empty or full single-color bottles only', () => {
    expect(isComplete(tube([]), 4)).toBe(true);
    expect(isComplete(tube(['r', 'r', 'r', 'r']), 4)).toBe(true);
    expect(isComplete(tube(['r', 'r', 'r']), 4)).toBe(false); // single color but not full
    expect(isComplete(tube(['r', 'r', 'r', 'g']), 4)).toBe(false);
  });
});

describe('canPour', () => {
  it('rejects same-bottle, empty source, full target', () => {
    const s = state([['r'], ['r', 'g', 'b', 'y'], []]);
    expect(canPour(s, 0, 0)).toBe(false); // same bottle
    expect(canPour(s, 2, 0)).toBe(false); // empty source
    expect(canPour(s, 0, 1)).toBe(false); // full target
  });

  it('allows pour onto empty or matching top color', () => {
    const s = state([['r', 'g'], ['g'], []]);
    expect(canPour(s, 0, 1)).toBe(true); // g onto g
    expect(canPour(s, 0, 2)).toBe(true); // g onto empty
  });

  it('rejects pour onto mismatched color', () => {
    const s = state([['r', 'g'], ['b']]);
    expect(canPour(s, 0, 1)).toBe(false); // g onto b
  });
});

describe('pour', () => {
  it('moves only the top run, limited by free space, immutably', () => {
    const s = state([['r', 'g', 'g', 'g'], ['g']]);
    const { state: next, move } = pour(s, 0, 1);
    expect(move).toEqual({ from: 0, to: 1, count: 3, color: color('g') });
    expect(next.bottles[0]).toEqual(tube(['r']));
    expect(next.bottles[1]).toEqual(tube(['g', 'g', 'g', 'g']));
    // original untouched
    expect(s.bottles[0]).toEqual(tube(['r', 'g', 'g', 'g']));
  });

  it('limits the count to the destination free space', () => {
    const s = state([['g', 'g', 'g'], ['g', 'g']]); // dst free space = 2
    const { state: next, move } = pour(s, 0, 1);
    expect(move.count).toBe(2);
    expect(next.bottles[0]).toEqual(tube(['g']));
    expect(next.bottles[1]).toEqual(tube(['g', 'g', 'g', 'g']));
  });

  it('pourAmount returns 0 for illegal pours and pour throws', () => {
    const s = state([['r', 'g'], ['b']]);
    expect(pourAmount(s, 0, 1)).toBe(0);
    expect(() => pour(s, 0, 1)).toThrow();
  });
});

describe('win / deadlock', () => {
  it('isWon when all bottles are complete', () => {
    expect(isWon(state([['r', 'r', 'r', 'r'], []]))).toBe(true);
    expect(isWon(state([['r', 'r', 'r'], ['r']]))).toBe(false);
  });

  it('legalMoves enumerates available pours', () => {
    const s = state([['r'], ['r'], []]);
    // 0->1, 1->0, 0->2, 1->2  (pours onto matching or empty)
    expect(legalMoves(s).length).toBe(4);
  });

  it('isDeadlocked is true when stuck and unsolved', () => {
    // Two bottles, each full with two colors, no empties, mismatched tops.
    const stuck = state([
      ['r', 'g', 'r', 'g'],
      ['g', 'r', 'g', 'r'],
    ]);
    expect(isDeadlocked(stuck)).toBe(true);
  });

  it('isDeadlocked is false when won', () => {
    expect(isDeadlocked(state([['r', 'r', 'r', 'r'], []]))).toBe(false);
  });
});
