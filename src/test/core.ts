/**
 * Wasm-driven test utilities. Since the JS rules oracle was retired, the ONLY implementation of
 * the game rules is the Rust core; tests that need to "play" a board (replay a stored solution,
 * enumerate reachable states, check winnability) drive the SHIPPING wasm through the same
 * adapter seams the store uses (`wasmPlanTap` / `wasmBoardView` / `wasmHintMove` — the test
 * setup loads the committed `.wasm` synchronously before any spec runs). Nothing here encodes a
 * pour rule of its own, so these helpers can never drift from the runtime.
 */
import { wasmBoardView, wasmHintMove, wasmPlanTap } from '../game/coreWasm';
import { emptyGrid, type HiddenGrid } from '../game/hidden';
import type { Overlays } from '../game/overlays';
import type { GameState, Move } from '../game/types';

/**
 * Order-independent, injective key for a (board, concealment) state — the retired solver's
 * `canonical`/`stateKey`, kept as a pure NORMALIZATION (it encodes no game rules): bottles
 * serialize bottom-first as interned color chars ("?"-prefixed while concealed) and sort, so
 * boards differing only by tube order collapse to one key. Compared for equality only.
 */
const interned = new Map<string, string>();
function codeFor(color: string): string {
  let code = interned.get(color);
  if (code == null) {
    code = String.fromCharCode(33 + interned.size);
    interned.set(color, code);
  }
  return code;
}
export function stateKey(state: GameState, hidden?: HiddenGrid): string {
  const parts = state.bottles.map((bottle, i) => {
    let s = '';
    for (let j = 0; j < bottle.length; j++) s += (hidden?.[i]?.[j] ? '?' : '') + codeFor(bottle[j]!);
    return s;
  });
  parts.sort();
  return parts.join('|');
}

/** Whether the board (with its overlays) is in the won status per the core's own view. */
export function isWonState(state: GameState, hidden?: HiddenGrid, overlays?: Overlays): boolean {
  return wasmBoardView(state, hidden ?? emptyGrid(state), overlays, null, false).status === 'won';
}

/**
 * The legal pours from a state, per the core's tap planner: every (from, to) pair whose tap —
 * with `from` selected — the core resolves to a pour. Returns the resulting plan alongside the
 * pair so callers can walk the state graph without re-planning.
 */
export function legalPours(
  state: GameState,
  hidden?: HiddenGrid,
  overlays?: Overlays,
): { move: Move; next: GameState; nextHidden: HiddenGrid }[] {
  const grid = hidden ?? emptyGrid(state);
  const pours: { move: Move; next: GameState; nextHidden: HiddenGrid }[] = [];
  for (let from = 0; from < state.bottles.length; from++) {
    for (let to = 0; to < state.bottles.length; to++) {
      if (from === to) continue;
      const plan = wasmPlanTap(state, grid, overlays, from, to);
      if (plan.kind === 'pour') {
        pours.push({ move: plan.move, next: plan.next, nextHidden: plan.revealedHidden });
      }
    }
  }
  return pours;
}

/** Every board reachable from `start` by legal pours (the closure the stuck check reasons over). */
export function reachableClosure(start: GameState): GameState[] {
  const seen = new Set<string>([stateKey(start)]);
  const states = [start];
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const { next } of legalPours(current)) {
      const key = stateKey(next);
      if (!seen.has(key)) {
        seen.add(key);
        states.push(next);
        stack.push(next);
      }
    }
  }
  return states;
}

/**
 * Replay a stored full-information solution under the real interaction rules (core-side capped
 * pours + reveals). One stored move can take several taps when concealed cells split its run —
 * the same remaining-count loop the retired `cappedSolveMoves` oracle used, but every pour is
 * decided by the shipping core. Throws if a move stops being legal, so a broken solution fails
 * the calling test loudly.
 */
export function replaySolution(
  state: GameState,
  solution: readonly Move[],
  hidden?: HiddenGrid,
  overlays?: Overlays,
): { state: GameState; hidden: HiddenGrid; taps: number } {
  let cur = state;
  let grid = hidden ?? emptyGrid(state);
  let taps = 0;
  for (const m of solution) {
    let remaining = m.count;
    while (remaining > 0) {
      const plan = wasmPlanTap(cur, grid, overlays, m.from, m.to);
      if (plan.kind !== 'pour') {
        throw new Error(`solution move ${m.from}→${m.to} is not a legal pour (got ${plan.kind})`);
      }
      cur = plan.next;
      grid = plan.revealedHidden;
      remaining -= plan.move.count;
      taps++;
    }
  }
  return { state: cur, hidden: grid, taps };
}

/** Node budget per hint while solving a board in a test (small boards resolve well under this). */
const SOLVE_HINT_BUDGET = 200_000;
/** Hard stop for `solveViaHints` — no test board needs anywhere near this many pours. */
const SOLVE_MAX_TAPS = 400;

/**
 * Solve a board by following the core's own hints to the win, returning the tap-level line of
 * (from, to) moves — or `null` if the core can't find one. The replacement for the retired JS
 * `solve()` in specs that need a winning line: the line comes from (and is validated by) the
 * shipping rules, and since moves are tube indices it replays cleanly on any recoloring of the
 * same layout.
 */
export function solveViaHints(
  state: GameState,
  hidden?: HiddenGrid,
  overlays?: Overlays,
): { from: number; to: number }[] | null {
  let cur = state;
  let grid = hidden ?? emptyGrid(state);
  const line: { from: number; to: number }[] = [];
  while (!isWonState(cur, grid, overlays)) {
    if (line.length >= SOLVE_MAX_TAPS) return null;
    const hint = wasmHintMove(cur, grid, overlays, SOLVE_HINT_BUDGET);
    if (!hint) return null;
    const plan = wasmPlanTap(cur, grid, overlays, hint.from, hint.to);
    if (plan.kind !== 'pour') return null;
    cur = plan.next;
    grid = plan.revealedHidden;
    line.push({ from: hint.from, to: hint.to });
  }
  return line;
}
