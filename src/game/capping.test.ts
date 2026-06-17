import { describe, it, expect } from 'vitest';
import { canPour, isWon, pour } from './engine';
import { canonical, isSolvable } from './solver';
import { mulberry32 } from './generator';
import type { Bottle, GameState } from './types';

/**
 * Cap-aware solvability: a BFS that, like the player, may NOT pour from a capped tube (full,
 * single color). This locks in the property that justifies leaving the deadlock worker
 * full-information: capping a finished tube never changes whether a board is winnable.
 */
function capSolvable(state: GameState): boolean {
  const seen = new Set<string>([canonical(state)]);
  let frontier = [state];
  let nodes = 0;
  while (frontier.length) {
    const next: GameState[] = [];
    for (const s of frontier) {
      if (isWon(s)) return true;
      const n = s.bottles.length;
      for (let f = 0; f < n; f++) {
        const src = s.bottles[f]!;
        const capped = src.length === s.capacity && src.every((c) => c === src[0]);
        if (src.length === 0 || capped) continue;
        for (let t = 0; t < n; t++) {
          if (!canPour(s, f, t)) continue;
          const child = pour(s, f, t).state;
          const key = canonical(child);
          if (seen.has(key)) continue;
          seen.add(key);
          if (++nodes > 200_000) return false;
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return false;
}

function randomBoard(rng: () => number, colors: number, empties: number, cap: number): GameState {
  const segs: string[] = [];
  for (let c = 0; c < colors; c++) for (let k = 0; k < cap; k++) segs.push(`C${c}`);
  for (let i = segs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [segs[i], segs[j]] = [segs[j]!, segs[i]!];
  }
  const bottles: string[][] = [];
  for (let c = 0; c < colors; c++) bottles.push(segs.slice(c * cap, c * cap + cap));
  for (let e = 0; e < empties; e++) bottles.push([]);
  return { bottles: bottles as Bottle[], capacity: cap };
}

describe('capping never changes solvability', () => {
  // This is the load-bearing fact behind cap-aware deadlock detection: because a finished tube
  // holds ALL of its color and can't be emptied without pre-existing free space, no solution
  // ever needs to pour from it. So the full-information solver (used in the deadlock worker) and
  // the cap-constrained player agree on every board — there are no "stuck under capping" cases
  // the worker would miss.
  it('cap-aware and full-information solvability agree across many random boards', () => {
    const rng = mulberry32(98765);
    let mismatches = 0;
    for (let i = 0; i < 800; i++) {
      const colors = 2 + Math.floor(rng() * 3); // 2..4
      const empties = Math.floor(rng() * 3); // 0..2
      const cap = 2 + Math.floor(rng() * 2); // 2..3
      const state = randomBoard(rng, colors, empties, cap);
      if (capSolvable(state) !== isSolvable(state)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});
