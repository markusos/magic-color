/**
 * Solver for the color-sort puzzle. Used to (a) verify that a generated level is
 * actually solvable — the hard guarantee behind the generator — and (b) compute a
 * known solution and its step count. The same machinery can later power a "hint" tool.
 */
import { isWon, legalMoves, pour, topColor } from './engine';
import { funnelAccepts, type FunnelGrid } from './funnels';
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
  /**
   * Color-locked funnels overlay (chapter 2+). When present, a pour into a tube whose tint rejects
   * the poured color is omitted from the search — the same constraint the player plays under. Default
   * `undefined` ⇒ no funnels, so every search behaves exactly as the un-funneled game.
   */
  funnels?: FunnelGrid;
}

/**
 * Decide whether a candidate pour is worth exploring. Prunes moves that can never help:
 * - pouring a bottle that is already a finished single color, and
 * - pouring into one of several interchangeable empty bottles (only the first matters).
 *
 * With `funnels`, a pour the destination tube's tint rejects is also pruned (it isn't a legal player
 * move). Folding the funnel gate in here means every search built on `isUsefulMove` — `search`,
 * `isStuckInLoop`, `bfsOptimal`, and `usefulMoves` (the difficulty metrics) — honors funnels through
 * one shared check.
 */
function isUsefulMove(state: GameState, from: number, to: number, funnels?: FunnelGrid): boolean {
  const src = state.bottles[from]!;
  const dst = state.bottles[to]!;

  const color = topColor(src)!;
  // A funnel rejects any inflow that isn't its tint — not a legal move to consider.
  if (!funnelAccepts(funnels, to, color)) return false;

  // Don't disturb a bottle that is already uniformly one color filling it entirely
  // unless the destination is also that same color (consolidation is pointless here).
  const srcUniform = src.length > 0 && src.every((c) => c === src[0]);
  if (srcUniform && dst.length === 0) return false; // moving a solid block to empty = no progress

  // Among equivalent empty destinations, only consider the first one — but funnels make empties
  // non-interchangeable, so the representative is the first empty that ALSO accepts this color (an
  // empty locked to another color is a different destination, not a redundant copy of this one).
  if (dst.length === 0) {
    const firstEmpty = state.bottles.findIndex(
      (b, idx) => b.length === 0 && funnelAccepts(funnels, idx, color),
    );
    if (to !== firstEmpty) return false;
  }
  return true;
}

/**
 * The legal moves worth considering from a state — `legalMoves` minus the ones `isUsefulMove`
 * prunes (disturbing a finished solid block, pouring into a redundant empty, or — under `funnels` —
 * a pour a destination funnel rejects). This is the branching the search actually explores, so
 * difficulty metrics (branching factor, forced-move ratio in `difficulty.ts`) measure against it
 * rather than the raw legal-move count.
 */
export function usefulMoves(
  state: GameState,
  funnels?: FunnelGrid,
): Array<{ from: number; to: number }> {
  return legalMoves(state).filter(({ from, to }) => isUsefulMove(state, from, to, funnels));
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
 * One node on the explicit DFS stack: a board already "entered" (counted, marked visited, and not a
 * goal), its useful successor moves, and how many of them we've tried. The shared `path` array mirrors
 * the stack — one move per non-root frame — so it always holds the moves from the root to the current
 * node without per-node copying.
 */
interface Frame {
  state: GameState;
  moves: Array<{ from: number; to: number }>;
  /** Index of the next move in `moves` to descend into. */
  next: number;
}

/**
 * Depth-first search for *a* solution, reporting whether the search was exhaustive. This is the
 * primitive behind `solve`, `isSolvable`, and `isUnsolvable`.
 *
 * Iterative (explicit stack) rather than recursive: the search runs up to `maxNodes` (200k) deep, so
 * recursion risked a stack overflow on the most tangled large boards, and the old `[...path, move]`
 * rebuilt the whole path at every node (O(nodes · depth) allocation). Here a single mutable `path`
 * shadows the frame stack — pushed when we descend, popped when we backtrack — so it's allocation-free
 * per node. The traversal is the same pre-order DFS with the same prune order, so it explores the
 * identical node sequence and returns the identical first solution (this is what lets a re-bake
 * reproduce earlier chapters byte-identically).
 */
export function search(state: GameState, options: SolveOptions = {}): SolveResult {
  const maxNodes = options.maxNodes ?? 200_000;
  const visited = new Set<string>();
  let nodes = 0;
  let hitCap = false;

  const path: Move[] = [];
  const stack: Frame[] = [];

  /**
   * "Enter" a node, mirroring the per-call gate of the old recursion: a goal short-circuits the
   * search, the node budget aborts the branch (flagging `hitCap`), an already-visited board is
   * pruned, and a fresh board is marked visited and pushed as a new frame. Returns what happened so
   * the driver can keep `path` in sync.
   */
  const enter = (current: GameState): 'won' | 'pruned' | 'pushed' => {
    if (isWon(current)) return 'won';
    if (++nodes > maxNodes) {
      hitCap = true;
      return 'pruned';
    }
    const key = canonical(current);
    if (visited.has(key)) return 'pruned';
    visited.add(key);
    stack.push({ state: current, moves: usefulMoves(current, options.funnels), next: 0 });
    return 'pushed';
  };

  if (enter(state) === 'won') return { solution: [], exhausted: !hitCap };

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.next >= frame.moves.length) {
      stack.pop();
      if (stack.length > 0) path.pop(); // a non-root frame: drop the move that led into it
      continue;
    }
    const { from, to } = frame.moves[frame.next++]!;
    const { state: next, move } = pour(frame.state, from, to);
    path.push(move);
    const result = enter(next);
    if (result === 'won') return { solution: path.slice(), exhausted: !hitCap };
    if (result === 'pruned') path.pop(); // didn't descend — undo the tentative move
    // 'pushed': the move stays on `path`; the new frame is now the top of the stack.
  }

  return { solution: null, exhausted: !hitCap };
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
 * Whether the player is provably going in circles: every state reachable from `state` (under the
 * same useful-move pruning the solver explores) has *already been visited this attempt* — so no
 * move can ever produce a board the player hasn't already seen; the only moves left loop back.
 *
 * This is the trigger for the gentle "going in circles" nudge, distinct from `engine.isDeadlocked`
 * (a hard zero-moves wall) and from `isUnsolvable` (which would fire the instant a board becomes
 * unwinnable — even with plenty of fresh states still to explore, which we deliberately don't
 * interrupt). Reusing `isUsefulMove` is what makes the distinction meaningful: parking a finished
 * solid block in an empty tube is not a real "somewhere new to go", so a spare empty bottle can't
 * disguise a dead end.
 *
 * Conservative by construction: it returns `false` the moment it finds any unvisited reachable
 * state, and also `false` if the search hits the node budget (inconclusive) — so a player who
 * still has somewhere meaningful to go is never nagged.
 */
export function isStuckInLoop(
  state: GameState,
  visited: ReadonlySet<string>,
  options: SolveOptions = {},
): boolean {
  const maxNodes = options.maxNodes ?? 20_000;
  const seen = new Set<string>([canonical(state)]);
  const stack: GameState[] = [state];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (++nodes > maxNodes) return false; // inconclusive — don't nag
    for (const { from, to } of legalMoves(current)) {
      if (!isUsefulMove(current, from, to, options.funnels)) continue;
      const { state: next } = pour(current, from, to);
      if (isWon(next)) return false; // a win is reachable (and would be unvisited anyway)
      const key = canonical(next);
      if (!visited.has(key)) return false; // somewhere new to go → not circling
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(next);
    }
  }
  return true; // whole reachable closure already visited — only loops remain
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
        if (!isUsefulMove(current, from, to, options.funnels)) continue;
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
