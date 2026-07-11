import { describe, it, expect } from 'vitest';
import { emptyGrid } from './hidden';
import { board } from '../test/board';

// The hidden-colors RULE and its solvable-by-construction derivation live in the Rust core
// (core/src/hidden.rs — covered by the crate's tests and the committed conformance vectors);
// only the display-side helper remains on the JS side.

describe('emptyGrid', () => {
  it('matches the board shape and conceals nothing', () => {
    const grid = emptyGrid(board([['ruby', 'amber'], []]));
    expect(grid).toEqual([[false, false], []]);
  });
});
