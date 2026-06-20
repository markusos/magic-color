/**
 * Solver for the color-sort puzzle. Used to (a) verify that a generated level is
 * actually solvable — the hard guarantee behind the generator — and (b) compute a
 * known solution and its step count. The same machinery can later power a "hint" tool.
 */
import { isWon, legalMoves, pour } from './engine';
import { stateKey } from './search';
import type { GameState, Move } from './types';

/**
 * An order-independent string key for a (full-information) state — the no-concealment case of
 * the shared {@link stateKey}. Two boards that differ only by bottle ordering collapse to the
 * same key, which dramatically shrinks the search space.
 */
export function canonical(state: GameState): string {
  return stateKey(state);
}

interface SolveOptions {
  /** Safety cap on explored nodes so generation can never hang. Default 200k. */
  maxNodes?: number;
}

/**
 * Decide whether a candidate pour is worth exploring. Prunes moves that can never help:
 * - pouring a bottle that is already a finished single color, and
 * - pouring into one of several interchangeable empty bottles (only the first matters).
 */
function isUsefulMove(state: GameState, from: number, to: number): boolean {
  const src = state.bottles[from]!;
  const dst = state.bottles[to]!;

  // Don't disturb a bottle that is already uniformly one color filling it entirely
  // unless the destination is also that same color (consolidation is pointless here).
  const srcUniform = src.length > 0 && src.every((c) => c === src[0]);
  if (srcUniform && dst.length === 0) return false; // moving a solid block to empty = no progress

  // Among equivalent empty destinations, only consider the first empty bottle.
  if (dst.length === 0) {
    const firstEmpty = state.bottles.findIndex((b) => b.length === 0);
    if (to !== firstEmpty) return false;
  }
  return true;
}

/**
 * The legal moves worth considering from a state — `legalMoves` minus the ones `isUsefulMove`
 * prunes (disturbing a finished solid block, or pouring into a redundant empty). This is the
 * branching the search actually explores, so difficulty metrics (branching factor, forced-move
 * ratio in `difficulty.ts`) measure against it rather than the raw legal-move count.
 */
export function usefulMoves(state: GameState): Array<{ from: number; to: number }> {
  return legalMoves(state).filter(({ from, to }) => isUsefulMove(state, from, to));
}

export interface SolveResult {
  /** A winning move sequence, or `null` if none was found. */
  solution: Move[] | null;
  /**
   * True when the search explored the entire reachable state space without hitting the
   * node budget. A `null` solution with `exhausted: true` is a *proof* that the board is
   * unsolvable; a `null` solution with `exhausted: false` is merely inconclusive (the
   * search gave up early), so callers must not treat it as a deadlock.
   */
  exhausted: boolean;
}

/**
 * Depth-first search for *a* solution, reporting whether the search was exhaustive.
 * This is the primitive behind `solve`, `isSolvable`, and `isUnsolvable`.
 */
export function search(state: GameState, options: SolveOptions = {}): SolveResult {
  const maxNodes = options.maxNodes ?? 200_000;
  const visited = new Set<string>();
  let nodes = 0;
  let hitCap = false;

  const dfs = (current: GameState, path: Move[]): Move[] | null => {
    if (isWon(current)) return path;
    if (++nodes > maxNodes) {
      hitCap = true;
      return null;
    }

    const key = canonical(current);
    if (visited.has(key)) return null;
    visited.add(key);

    for (const { from, to } of legalMoves(current)) {
      if (!isUsefulMove(current, from, to)) continue;
      const { state: next, move } = pour(current, from, to);
      const result = dfs(next, [...path, move]);
      if (result) return result;
    }
    return null;
  };

  const solution = dfs(state, []);
  return { solution, exhausted: !hitCap };
}

/**
 * Find a solution, or `null` if the board is unsolvable or the node budget is exhausted
 * (both treated as "reject" by the generator).
 */
export function solve(state: GameState, options?: SolveOptions): Move[] | null {
  return search(state, options).solution;
}

/** Whether a state can be solved at all (thin wrapper over `search`). */
export function isSolvable(state: GameState, options?: SolveOptions): boolean {
  return search(state, options).solution !== null;
}

/**
 * Proof-based deadlock: the board is unwinnable and the solver has *exhaustively* shown
 * it. Unlike `engine.isDeadlocked` (which only catches boards with zero legal moves),
 * this also detects "loops" — boards where moves remain but none can ever lead to a win.
 * Returns `false` if the search was inconclusive (hit the node budget), so a winnable
 * game is never ended by mistake.
 */
export function isUnsolvable(state: GameState, options?: SolveOptions): boolean {
  const { solution, exhausted } = search(state, options);
  return solution === null && exhausted;
}

/**
 * Breadth-first search for the *minimum* number of moves. Heavier than `solve`, so it's
 * intended only for difficulty calibration on small boards. Returns `null` if unsolved
 * within the node budget.
 */
export function bfsOptimal(state: GameState, options: SolveOptions = {}): number | null {
  const maxNodes = options.maxNodes ?? 200_000;
  if (isWon(state)) return 0;

  const visited = new Set<string>([canonical(state)]);
  let frontier: GameState[] = [state];
  let depth = 0;
  let nodes = 0;

  while (frontier.length > 0) {
    const next: GameState[] = [];
    depth++;
    for (const current of frontier) {
      for (const { from, to } of legalMoves(current)) {
        if (!isUsefulMove(current, from, to)) continue;
        const { state: child } = pour(current, from, to);
        if (isWon(child)) return depth;
        const key = canonical(child);
        if (visited.has(key)) continue;
        visited.add(key);
        if (++nodes > maxNodes) return null;
        next.push(child);
      }
    }
    frontier = next;
  }
  return null;
}
