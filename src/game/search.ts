/**
 * Shared graph-search infrastructure for the color-sort puzzle. The DFS/BFS solver
 * (`solver.ts`) and the exact hidden-aware optimum below all build on the same state hashing
 * and helpers, so the search primitives live in exactly one place rather than being copied
 * per call site.
 *
 * This module owns the *searches*; `hidden.ts` owns the concealment *mechanic* (which cells
 * are hidden, how they reveal). Search depends on the mechanic's read-only helpers, never the
 * other way around.
 */
import { anyHidden, isCapped, knownTopRun, revealExposed, type HiddenGrid } from './hidden';
import { canPour, isWon, pour } from './engine';
import type { GameState } from './types';

/**
 * An order-independent string key for a (board, concealment) state. Bottles are serialized
 * bottom-first — concealed cells prefixed with "?" — then sorted, so two boards that differ
 * only by bottle ordering collapse to the same key (which dramatically shrinks the search
 * space). Omit `hidden` for full-information boards; the result then matches a plain
 * color-only canonicalization.
 */
export function stateKey(state: GameState, hidden?: HiddenGrid): string {
  return state.bottles
    .map((b, i) => b.map((c, j) => (hidden?.[i]?.[j] ? '?' : '') + c).join(','))
    .sort()
    .join('|');
}

/** A tiny binary min-heap for the A* frontier. */
export class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly cmp: (a: T, b: T) => number) {}
  get size(): number {
    return this.items.length;
  }
  push(value: T): void {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(a[i]!, a[p]!) >= 0) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && this.cmp(a[l]!, a[s]!) < 0) s = l;
        if (r < a.length && this.cmp(a[r]!, a[s]!) < 0) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s]!, a[i]!];
        i = s;
      }
    }
    return top;
  }
}

/**
 * Admissible heuristic: (monochrome runs) − (distinct colors). Each pour cuts this by at most 1
 * and it's 0 only when every color is a single run, so it never overestimates the pours left.
 */
export function runsHeuristic(state: GameState): number {
  let runs = 0;
  const colors = new Set<string>();
  for (const bottle of state.bottles) {
    for (let i = 0; i < bottle.length; i++) {
      colors.add(bottle[i]!);
      if (i === 0 || bottle[i] !== bottle[i - 1]) runs++;
    }
  }
  return runs - colors.size;
}

/** A successor (board, concealment) state reached by one capped pour. */
interface CappedSuccessor {
  state: GameState;
  hidden: HiddenGrid;
}

/**
 * The (board, concealment) states reachable by one CAPPED player pour, under the same rules the
 * player plays: each pour is limited to the visible top run, concealed cells reveal as they surface,
 * finished/capped tubes can't be poured from, and the obviously-pointless moves are pruned
 * (interchangeable empties collapsed; relocating a fully-revealed solid block to an empty tube
 * dropped). Shared by `optimalCappedMoves` (exact A*) and `nearOptimalCutoffs` (tier BFS) so both
 * explore the identical move graph.
 */
function cappedSuccessors(state: GameState, hidden: HiddenGrid): CappedSuccessor[] {
  const out: CappedSuccessor[] = [];
  const n = state.bottles.length;
  const firstEmpty = state.bottles.findIndex((b) => b.length === 0);
  for (let from = 0; from < n; from++) {
    const src = state.bottles[from]!;
    // A capped (finished) tube can't be poured from — same rule the player plays under.
    if (src.length === 0 || isCapped(src, state.capacity, hidden[from])) continue;
    const cap = knownTopRun(src, hidden[from]);
    const srcUniform = src.every((c) => c === src[0]);
    const srcConcealed = hidden[from]?.some(Boolean) ?? false;
    for (let to = 0; to < n; to++) {
      if (from === to) continue;
      const dst = state.bottles[to]!;
      if (dst.length === 0) {
        if (to !== firstEmpty) continue; // empties are interchangeable
        // Relocating a fully-revealed solid block to an empty tube is never progress.
        if (srcUniform && !srcConcealed) continue;
      }
      if (!canPour(state, from, to)) continue;
      const { state: next } = pour(state, from, to, cap);
      out.push({ state: next, hidden: revealExposed(next, hidden) });
    }
  }
  return out;
}

/** A fully-solved, fully-revealed board — the search goal. */
function isSolved(state: GameState, hidden: HiddenGrid): boolean {
  return isWon(state) && !anyHidden(hidden);
}

/**
 * The exact minimum number of player pours to fully solve a board: A* over (board, concealment)
 * states where moves are CAPPED pours (limited to the visible run, concealed cells revealing as
 * they surface) and the goal is a sorted board with every cell revealed. This captures the real
 * cost of hidden levels — both run-splitting and digging out buried "?"s — with no fudge factor.
 * For a board with no concealment it reduces to the exact bulk-optimal.
 *
 * Returns `null` if the node budget is exhausted (extremely tangled board), so callers can fall
 * back to a cheaper upper-bound estimate rather than hang.
 */
export function optimalCappedMoves(
  state0: GameState,
  hidden0: HiddenGrid,
  maxNodes = 12_000,
): number | null {
  const key0 = stateKey(state0, hidden0);
  const bestG = new Map<string, number>([[key0, 0]]);
  const heap = new MinHeap<{
    state: GameState;
    hidden: HiddenGrid;
    g: number;
    f: number;
    key: string;
  }>((a, b) => a.f - b.f);
  heap.push({ state: state0, hidden: hidden0, g: 0, f: runsHeuristic(state0), key: key0 });

  let nodes = 0;
  while (heap.size > 0) {
    const cur = heap.pop()!;
    if ((bestG.get(cur.key) ?? Infinity) < cur.g) continue; // stale heap entry
    if (isSolved(cur.state, cur.hidden)) return cur.g;
    if (++nodes > maxNodes) return null;

    for (const { state: next, hidden: nextHidden } of cappedSuccessors(cur.state, cur.hidden)) {
      const nextKey = stateKey(next, nextHidden);
      const ng = cur.g + 1;
      if (ng < (bestG.get(nextKey) ?? Infinity)) {
        bestG.set(nextKey, ng);
        heap.push({ state: next, hidden: nextHidden, g: ng, f: ng + runsHeuristic(next), key: nextKey });
      }
    }
  }
  return null;
}

/** Star-rating cutoffs for a board: the exact optimal (3★) and the adjusted near-optimal 2★ ceiling. */
export interface StarCutoffs {
  /** Exact minimum player pours — the 3★ cutoff (same value `optimalCappedMoves` returns). */
  optimal: number;
  /**
   * Largest move count still worth 2★: the *second* distinct achievable solution length above
   * `optimal` ("1–2 steps from optimal"), snapped to what the board actually offers. Always
   * `> optimal`.
   */
  twoStarMax: number;
}

/**
 * The star cutoffs for a board, computed by enumerating the shortest few *distinct* solution lengths
 * under the same capped/reveal move rules as {@link optimalCappedMoves}. A layered breadth-first
 * sweep (states deduplicated within each depth, but a state may recur across depths so genuinely
 * longer solutions are seen) records the depths at which a fully-solved board first becomes
 * reachable: the first is the exact optimal, and the third — i.e. two tiers up — is the 2★ ceiling.
 *
 * "Adjusted for available sub-optimal solutions": rather than a flat `optimal + 2`, the band snaps to
 * the lengths this particular board can actually be solved in, so a tightly-forced board (whose only
 * near-optimal alternatives are a few moves up) gets a correspondingly wider 2★ band than one rich in
 * one-move-longer lines.
 *
 * Returns `null` if the node budget is exhausted before even the optimal is found (extremely tangled
 * board), so callers fall back to a cheaper estimate. If the budget runs out *after* the optimal is
 * known but before two sub-optimal tiers are seen, `twoStarMax` falls back to `optimal + 2`.
 */
export function nearOptimalCutoffs(
  state0: GameState,
  hidden0: HiddenGrid,
  maxNodes = 200_000,
): StarCutoffs | null {
  // One layer = every state reachable in exactly `depth` capped pours (deduped within the layer).
  let layer = new Map<string, CappedSuccessor>([[stateKey(state0, hidden0), { state: state0, hidden: hidden0 }]]);
  const goalDepths: number[] = [];
  let depth = 0;
  let nodes = 0;

  const finalize = (): StarCutoffs | null => {
    if (goalDepths.length === 0) return null;
    const optimal = goalDepths[0]!;
    // Two tiers up if we found them; otherwise a safe generous default above optimal.
    return { optimal, twoStarMax: goalDepths[2] ?? goalDepths[1] ?? optimal + 2 };
  };

  while (layer.size > 0) {
    if ([...layer.values()].some(({ state, hidden }) => isSolved(state, hidden))) {
      goalDepths.push(depth);
      if (goalDepths.length >= 3) break; // optimal + two sub-optimal tiers is all we need
    }

    const next = new Map<string, CappedSuccessor>();
    for (const { state, hidden } of layer.values()) {
      if (isSolved(state, hidden)) continue; // solved boards have no useful successors
      for (const succ of cappedSuccessors(state, hidden)) {
        if (++nodes > maxNodes) return finalize();
        const key = stateKey(succ.state, succ.hidden);
        if (!next.has(key)) next.set(key, succ);
      }
    }
    layer = next;
    depth++;
  }

  return finalize();
}
