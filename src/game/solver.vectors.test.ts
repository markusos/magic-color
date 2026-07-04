/**
 * G1 pinning for the generator/solver/mechanic conformance vectors (Track F). The committed
 * `vectors/solver.json` is emitted from this JS core (`scripts/emit-vectors.ts`); this test
 * fails if a rule/RNG/prune change alters what the same seeds produce — forcing a deliberate
 * `npm run vectors:emit`, which in turn forces the Rust core (`core/tests/conformance.rs`) to
 * move in lockstep. Heavy searches are pinned on the Rust side only; here we re-derive the
 * cheap half (generation + overlays) for the small/medium cases to keep the suite fast.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeFunnels, funnelEligibleTubes } from './funnels';
import { generateLevel, PALETTE } from './generator';
import { cappedSolveMoves, computeHidden, exposableCells } from './hidden';
import { buildIce } from './ice';
import type { ParMode } from './types';

const vectorsPath = join(dirname(fileURLToPath(import.meta.url)), '../../vectors/solver.json');

interface SolverVectors {
  cases: {
    options: {
      colors: number;
      bottles: number;
      capacity: number;
      seed: number;
      minPar: number | null;
      parMode: ParMode;
    };
    state: number[][];
    solution: { from: number; to: number; count: number; color: number }[];
    minMoves: number;
    hidden: number[];
    cappedSolveMoves: number;
    funnels: (number | null)[];
    ice: { trigger: number | null; height: number }[];
  }[];
}

const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as SolverVectors;
// The 15-bottle cases cost seconds to regenerate in JS; the Rust conformance test covers
// them — here speed wins.
const cases = vectors.cases.filter((c) => c.options.bottles <= 10);

describe('solver shared vectors (JS pinning)', () => {
  it('has cases to assert', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    'seed $options.seed ($options.colors c / $options.bottles b) replays exactly',
    ({ options, state: cells, solution, minMoves, hidden, cappedSolveMoves: csm, funnels, ice }) => {
      const level = generateLevel({
        colors: options.colors,
        bottles: options.bottles,
        capacity: options.capacity,
        seed: options.seed,
        ...(options.minPar != null ? { minPar: options.minPar } : {}),
        parMode: options.parMode,
      });

      expect(level.state.bottles.map((b) => b.map((c) => PALETTE.indexOf(c)))).toEqual(cells);
      expect(
        level.solution.map((m) => ({ ...m, color: PALETTE.indexOf(m.color) })),
      ).toEqual(solution);
      expect(level.minMoves).toBe(minMoves);

      const grid = computeHidden(level.state, options.seed, exposableCells(level.state, level.solution));
      const masks = grid.map((col) => col.reduce((acc, hid, i) => acc | (hid ? 1 << i : 0), 0));
      expect(masks).toEqual(hidden);
      expect(cappedSolveMoves(level.state, level.solution, grid)).toBe(csm);

      const funnelGrid = computeFunnels(
        level.state,
        options.seed,
        funnelEligibleTubes(level.state, level.solution),
      );
      expect(funnelGrid.map((t) => (t == null ? null : PALETTE.indexOf(t)))).toEqual(funnels);

      const iceGrid = buildIce(level.state, level.solution, grid, options.seed);
      const iceTubes = iceGrid.map((col) => {
        const height = col.reduce<number>((acc, tint, i) => (tint != null ? i + 1 : acc), 0);
        return height === 0
          ? { trigger: null, height: 0 }
          : { trigger: PALETTE.indexOf(col[0]!), height };
      });
      expect(iceTubes).toEqual(ice);
    },
  );
});
