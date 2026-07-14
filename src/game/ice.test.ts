import { describe, it, expect } from 'vitest';
import { iceLoad, noIce, recolorIce, type IceGrid } from './ice';
import { board, color } from '../test/board';
import type { Color } from './types';

// The frozen-tubes RULE (blocking, thaw cascades, derived frozen state) and its
// solvable-by-construction derivation live in the Rust core (core/src/ice.rs — covered by the
// crate's tests and the committed conformance vectors); only the display-side helpers remain on
// the JS side.

const C = (id: string): Color => color(id);

describe('noIce', () => {
  it('is an all-clear grid shaped to the board', () => {
    const state = board([['ruby', 'ruby'], []], 4);
    expect(noIce(state)).toEqual([[null, null], []]);
  });
});

describe('recolorIce', () => {
  it('remaps every tint through the bijection, leaving nulls alone', () => {
    const g: IceGrid = [[C('ruby'), null], [C('teal')]];
    const map = { ruby: C('jade'), teal: C('rose') } as Record<string, Color>;
    expect(recolorIce(g, map)).toEqual([[C('jade'), null], [C('rose')]]);
  });
});

describe('iceLoad', () => {
  it('is the frozen-cell fraction', () => {
    expect(iceLoad([[null, null], [null]])).toBe(0);
    expect(
      iceLoad([
        [C('ruby'), C('ruby')],
        [null, null],
      ]),
    ).toBeCloseTo(0.5);
  });
});
