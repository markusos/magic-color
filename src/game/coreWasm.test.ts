/**
 * Smoke tests for the wasm runtime adapter: the committed `.wasm`, loaded for real (initSync
 * from bytes — no mocks), must expose working seams at exactly the points the store calls.
 * Rule CORRECTNESS is pinned Rust-side (the crate's tests + the committed conformance
 * vectors); what's asserted here is that the committed artifact + adapter marshalling work
 * end-to-end on real boards.
 */
import { describe, expect, it } from 'vitest';
import { coreWasmReady, coreWasmVersion, wasmHintMove, wasmPlanTap, wasmStuck } from './coreWasm';
import { emptyGrid } from './hidden';
import { board } from '../test/board';
import { isWonState, legalPours, reachableClosure, solveViaHints, stateKey } from '../test/core';

const HINT_BUDGET = 200_000;
const STUCK_BUDGET = 20_000;

// A small solvable board: one pour (1 → 0) finishes it.
const solvable = () => board([['r', 'r', 'r'], ['r'], []], 4);

// Unsolvable loop board: moves remain forever but it can never be won.
const loop = () =>
  board(
    [
      ['r', 'g', 'r', 'g'],
      ['g', 'r', 'g', 'r'],
      ['r', 'g'],
    ],
    4,
  );

describe('coreWasm adapter (committed artifact smoke)', () => {
  it('loads the committed wasm and reports a crate version', () => {
    // Source-hash freshness (crate ↔ committed .wasm) is coreVersion.test.ts's job; here we just
    // prove the loaded module answers through the boundary.
    expect(coreWasmReady()).toBe(true);
    expect(coreWasmVersion()).toBeTruthy();
  });

  it('hints a legal pour on a solvable board and follows through to the win', () => {
    const state = solvable();
    const hint = wasmHintMove(state, emptyGrid(state), undefined, HINT_BUDGET);
    expect(hint).not.toBeNull();
    const plan = wasmPlanTap(state, emptyGrid(state), undefined, hint!.from, hint!.to);
    expect(plan.kind).toBe('pour');
    expect(solveViaHints(state)).not.toBeNull();
  });

  it('returns no hint for a provably unsolvable board', () => {
    const state = loop();
    expect(wasmHintMove(state, emptyGrid(state), undefined, HINT_BUDGET)).toBeNull();
  });

  it('stuck registry: fresh boards are not stuck, a fully-visited closure is', () => {
    const start = loop();
    wasmStuck.reset(start);
    expect(wasmStuck.visitedCount()).toBe(1);
    // Only the start is visited — reachable fresh boards remain, so not "going in circles".
    expect(wasmStuck.check(start, undefined, STUCK_BUDGET)).toBe(false);

    // Visit the whole reachable closure: every continuation has been seen and none wins.
    const closure = reachableClosure(start);
    expect(closure.length).toBeGreaterThan(1);
    for (const s of closure) wasmStuck.visit(s);
    expect(wasmStuck.check(start, undefined, STUCK_BUDGET)).toBe(true);
  });

  it('reset clears the registry between boards', () => {
    const a = loop();
    wasmStuck.reset(a);
    const { next } = legalPours(a)[0]!;
    expect(stateKey(next)).not.toBe(stateKey(a));
    wasmStuck.visit(next);
    expect(wasmStuck.visitedCount()).toBe(2);
    wasmStuck.reset(solvable());
    expect(wasmStuck.visitedCount()).toBe(1);
  });

  it('a won board reads as won through the view seam', () => {
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    expect(isWonState(state)).toBe(true);
  });
});
