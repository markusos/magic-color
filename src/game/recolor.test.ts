import { describe, it, expect } from 'vitest';
import { applyColorMap, randomColorMap, recolor } from './recolor';
import { PALETTE } from './generator';
import { board as makeBoard, color } from '../test/board';

/** A deterministic rng from a list of [0,1) values, for pinning the random map in tests. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

const board = makeBoard([
  ['ruby', 'amethyst', 'ruby', 'amethyst'],
  ['amethyst', 'ruby', 'amethyst', 'ruby'],
  [],
]);

describe('randomColorMap', () => {
  it('maps each input id to a distinct palette hue', () => {
    const map = randomColorMap(['ruby', 'amethyst', 'sapphire'].map(color));
    const targets = Object.values(map);
    expect(new Set(targets).size).toBe(3); // all distinct
    expect(targets.every((t) => PALETTE.includes(t))).toBe(true);
  });

  it('can draw hues the level did not previously use (full-palette pool)', () => {
    // Force the partial shuffle to pick palette ids the board never had.
    const map = randomColorMap(['ruby'].map(color), seq([0.99]));
    expect(map.ruby).not.toBe('ruby');
    expect(PALETTE).toContain(map.ruby);
  });
});

describe('applyColorMap', () => {
  it('remaps every segment consistently and leaves shape untouched', () => {
    const out = applyColorMap(board, { ruby: color('teal'), amethyst: color('lime') });
    expect(out.bottles).toEqual([
      ['teal', 'lime', 'teal', 'lime'],
      ['lime', 'teal', 'lime', 'teal'],
      [],
    ]);
    expect(out.capacity).toBe(4);
  });

  it('does not mutate the input board', () => {
    const before = structuredClone(board);
    applyColorMap(board, { ruby: color('teal'), amethyst: color('lime') });
    expect(board).toEqual(before);
  });
});

describe('recolor', () => {
  it('preserves the layout up to a 1:1 color renaming', () => {
    const out = recolor(board, seq([0.5, 0.7, 0.1, 0.9]));
    // Same shape.
    expect(out.bottles.map((b) => b.length)).toEqual(board.bottles.map((b) => b.length));
    // Equal cells in the original stay equal after recoloring, and vice versa (bijection).
    const orig = board.bottles.flat();
    const next = out.bottles.flat();
    for (let i = 0; i < orig.length; i++) {
      for (let j = 0; j < orig.length; j++) {
        expect(next[i] === next[j]).toBe(orig[i] === orig[j]);
      }
    }
  });
});
