import { describe, it, expect } from 'vitest';
import { funnelLoad, noFunnels, recolorFunnels, type FunnelGrid } from './funnels';
import { board, color } from '../test/board';
import type { Color } from './types';

// The funnel RULE (destination color locks) and its solvable-by-construction derivation live in
// the Rust core (core/src/funnels.rs — covered by the crate's tests and the committed
// conformance vectors); only the display-side helpers remain on the JS side.

const C = (id: string): Color => color(id);

describe('noFunnels', () => {
  it('is an all-null grid shaped to the board', () => {
    expect(noFunnels(board([['ruby'], [], []], 4))).toEqual([null, null, null]);
  });
});

describe('recolorFunnels', () => {
  it('remaps every tint through the bijection, leaving nulls alone', () => {
    const funnels: FunnelGrid = [C('ruby'), null, C('teal')];
    const map = { ruby: C('jade'), teal: C('rose') } as Record<string, Color>;
    expect(recolorFunnels(funnels, map)).toEqual([C('jade'), null, C('rose')]);
  });
});

describe('funnelLoad', () => {
  it('is the locked-tube count over colors, clamped to 1', () => {
    expect(funnelLoad([null, null, null], 3)).toBe(0);
    expect(funnelLoad([C('ruby'), null, C('teal')], 4)).toBeCloseTo(0.5);
    expect(funnelLoad([C('ruby'), C('teal'), C('jade')], 2)).toBe(1); // clamped
  });
});
