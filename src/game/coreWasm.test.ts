/**
 * Differential tests for the wasm runtime adapter (Track F3): the committed `.wasm`, loaded
 * for real (initSync from bytes — no mocks), must agree with the JS implementations at the
 * exact seams the store swaps: `hintMove` and the stuck-loop check. This is the on-device A/B
 * contract, asserted in CI-shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { coreWasmReady, initCoreWasmSync, wasmHintMove, wasmStuck } from './coreWasm';
import { computeFunnels, funnelEligibleTubes } from './funnels';
import { generateLevel } from './generator';
import { cappedSolveMoves, computeHidden, exposableCells } from './hidden';
import { buildIce } from './ice';
import { pour } from './engine';
import { hintMove } from './search';
import { canonical, isStuckInLoop, usefulMoves } from './solver';

const wasmPath = join(dirname(fileURLToPath(import.meta.url)), 'core-pkg/magic_color_core_bg.wasm');

const HINT_BUDGET = 200_000;
const STUCK_BUDGET = 20_000;

beforeAll(() => {
  initCoreWasmSync(readFileSync(wasmPath));
});

describe('coreWasm adapter (differential vs JS)', () => {
  it('is ready after byte init', () => {
    expect(coreWasmReady()).toBe(true);
  });

  it('hint agrees with JS hintMove across mechanics and seeds', () => {
    for (const seed of [11, 22, 33, 44]) {
      const level = generateLevel({ colors: 4, bottles: 5, capacity: 4, seed });
      const { state, solution } = level;
      const hidden = computeHidden(state, seed, exposableCells(state, solution));
      const funnels = computeFunnels(state, seed, funnelEligibleTubes(state, solution));
      const ice = buildIce(state, solution, hidden, seed);
      const overlays = { funnels, ice };

      const js = hintMove(state, hidden, overlays, HINT_BUDGET);
      const wasm = wasmHintMove(state, hidden, overlays, HINT_BUDGET);
      expect(wasm).toEqual(js);
      // Sanity: the run replayed under capped rules is solvable, so a hint must exist.
      expect(cappedSolveMoves(state, solution, hidden)).toBeGreaterThan(0);
      expect(js).not.toBeNull();
    }
  });

  it('stuck registry mirrors the JS visited-set semantics through a play sequence', () => {
    const level = generateLevel({ colors: 3, bottles: 5, capacity: 4, seed: 77 });
    let state = level.state;
    const visited = new Set([canonical(state)]);
    wasmStuck.reset(state);
    expect(wasmStuck.visitedCount()).toBe(1);

    // Walk a few useful moves, mirroring both book-keepings, asserting agreement at each step.
    for (let step = 0; step < 4; step++) {
      const moves = usefulMoves(state);
      if (moves.length === 0) break;
      state = pour(state, moves[0]!.from, moves[0]!.to).state;
      visited.add(canonical(state));
      wasmStuck.visit(state);

      const js = isStuckInLoop(state, visited, { maxNodes: STUCK_BUDGET });
      const wasm = wasmStuck.check(state, undefined, STUCK_BUDGET);
      expect(wasm).toBe(js);
    }
  });

  it('reset clears the registry between boards', () => {
    const a = generateLevel({ colors: 3, bottles: 5, capacity: 4, seed: 1 }).state;
    const b = generateLevel({ colors: 3, bottles: 5, capacity: 4, seed: 2 }).state;
    wasmStuck.reset(a);
    wasmStuck.visit(pour(a, usefulMoves(a)[0]!.from, usefulMoves(a)[0]!.to).state);
    expect(wasmStuck.visitedCount()).toBe(2);
    wasmStuck.reset(b);
    expect(wasmStuck.visitedCount()).toBe(1);
  });
});
