/**
 * The "hidden colors" mechanic (chapter 1+). Some buried segments start concealed — shown as
 * a black band with a "?" — and reveal their true color ONLY by being exposed: i.e. by becoming
 * the top of their bottle. A tube is never considered finished while it still holds a concealed
 * cell, even if its real colors already match — you must surface every cell to complete it.
 *
 * The underlying GameState always holds the real colors; this is a pure presentation/
 * interaction overlay, so the engine, solver, and generator stay full-information.
 *
 * Concealment is a per-cell boolean grid parallel to `GameState.bottles` (bottom-first), kept
 * at the level's INITIAL dimensions. A concealed cell never moves while concealed (it can only
 * be poured after it has surfaced, which reveals it), so its [bottle][index] coordinate is
 * stable. Revealing permanently clears its bit.
 *
 * To keep every level beatable under this stricter rule, only cells that the level's stored
 * solution actually surfaces (`exposableCells`) are eligible to be concealed — so playing that
 * solution reveals all of them.
 */
import { canPour, isWon, pour } from './engine';
import { mulberry32 } from './generator';
import type { GameState, Move } from './types';

/**
 * Number of pour ACTIONS to play out `solution` under the real interaction rules — pours capped
 * to the visible run, with concealed cells revealing as they surface. This is an achievable
 * reference for the player's move count (what `moves.length` would be following this line), and
 * the basis for star thresholds. For a board with no concealment it equals `solution.length`
 * (each run pours in one tap); with hidden cells it's higher, because runs split at the "?"s.
 */
export function cappedSolveMoves(state: GameState, solution: Move[], hidden0: HiddenGrid): number {
  let current = state;
  let hidden = hidden0;
  let pours = 0;
  for (const m of solution) {
    let remaining = m.count;
    while (remaining > 0) {
      const cap = knownTopRun(current.bottles[m.from]!, hidden[m.from]);
      const { state: next, move } = pour(current, m.from, m.to, cap);
      current = next;
      hidden = revealExposed(current, hidden);
      pours++;
      remaining -= move.count;
    }
  }
  return pours;
}

/** A boolean overlay parallel to a board's bottles (bottom-first). */
export type HiddenGrid = boolean[][];

/** Fraction of eligible bottom-layer cells that start concealed (seeded). Tunable. */
export const HIDDEN_PROB = 0.65;
/** Only the bottom N layers may be concealed; the top is always known. */
const CONCEALABLE_LAYERS = 3;

/** An all-visible grid shaped to the board (used for chapter-0 levels and resets). */
export function emptyGrid(state: GameState): HiddenGrid {
  return state.bottles.map((bottle) => bottle.map(() => false));
}

/** Whether any cell in the grid is still concealed. */
export function anyHidden(hidden: HiddenGrid): boolean {
  return hidden.some((col) => col.some(Boolean));
}

/**
 * Whether a tube is "capped" — full, a single color, and fully revealed. A capped tube is
 * finished: no liquid may be poured in or out. A full single-color tube that still hides a cell
 * is NOT capped, so the player can pour from it to surface that cell.
 */
export function isCapped(bottle: string[], capacity: number, hiddenCol?: boolean[]): boolean {
  if (bottle.length !== capacity) return false;
  const first = bottle[0];
  if (!bottle.every((c) => c === first)) return false;
  return !hiddenCol?.some(Boolean);
}

/**
 * Which initial cells the given solution surfaces: cell (b, i) is exposable iff bottle b's
 * height drops to `i` or below at some point (so index i becomes the top and its original
 * segment is removed). Only these cells may be concealed, guaranteeing the solution reveals
 * every concealed cell.
 */
export function exposableCells(state: GameState, solution: Move[]): boolean[][] {
  const minHeight = state.bottles.map((bottle) => bottle.length);
  let current = state;
  for (const move of solution) {
    current = pour(current, move.from, move.to).state;
    current.bottles.forEach((bottle, b) => {
      if (bottle.length < minHeight[b]!) minHeight[b] = bottle.length;
    });
  }
  return state.bottles.map((bottle, b) => bottle.map((_, i) => minHeight[b]! <= i));
}

/**
 * Choose which cells start concealed: a seed-driven subset of the bottom `CONCEALABLE_LAYERS`
 * layers, restricted to cells the solution surfaces (`exposable`) and never the top. A draw is
 * consumed for every cell so the stream stays aligned regardless of eligibility.
 */
export function computeHidden(state: GameState, seed: number, exposable: boolean[][]): HiddenGrid {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return state.bottles.map((bottle, b) =>
    bottle.map((_, i) => {
      const conceal = rng() < HIDDEN_PROB;
      const isTop = i === bottle.length - 1;
      const eligible = i < CONCEALABLE_LAYERS && !isTop && (exposable[b]?.[i] ?? false);
      return eligible && conceal;
    }),
  );
}

/**
 * Reveal (permanently) any concealed cell that is now the top of its bottle. A tube's cells are
 * NOT revealed just because the tube looks complete — each must actually surface. Returns the
 * same grid reference when nothing changed, so callers can cheaply detect no-ops.
 */
export function revealExposed(state: GameState, hidden: HiddenGrid): HiddenGrid {
  let changed = false;
  const next = hidden.map((col, b) => {
    const topIndex = state.bottles[b]!.length - 1;
    return col.map((concealed, i) => {
      if (concealed && i === topIndex) {
        changed = true;
        return false;
      }
      return concealed;
    });
  });
  return changed ? next : hidden;
}

/**
 * The most segments a player may pour from a bottle: the contiguous, same-color, NON-concealed
 * run at the top. Concealed cells are unknown, so they block the run — this is what stops the
 * engine from bulk-pouring hidden segments the player can't see. The top is never concealed, so
 * a non-empty bottle always yields at least 1.
 */
export function knownTopRun(bottle: string[], hiddenCol: boolean[] | undefined): number {
  if (bottle.length === 0) return 0;
  const color = bottle[bottle.length - 1];
  let run = 0;
  for (let i = bottle.length - 1; i >= 0; i--) {
    if (hiddenCol?.[i]) break; // a concealed cell ends the visible run
    if (bottle[i] !== color) break;
    run++;
  }
  return run;
}

// --- Exact optimal (minimum player pours), hidden-aware -----------------------------------------

/** A tiny binary min-heap for the A* frontier. */
class MinHeap<T> {
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
function runsHeuristic(state: GameState): number {
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

/** Order-independent key for a (board, concealment) state — concealed cells marked with "?". */
function stateKey(state: GameState, hidden: HiddenGrid): string {
  return state.bottles
    .map((b, i) => b.map((c, j) => (hidden[i]?.[j] ? '?' : '') + c).join(','))
    .sort()
    .join('|');
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
    if (isWon(cur.state) && !anyHidden(cur.hidden)) return cur.g;
    if (++nodes > maxNodes) return null;

    const n = cur.state.bottles.length;
    const firstEmpty = cur.state.bottles.findIndex((b) => b.length === 0);
    for (let from = 0; from < n; from++) {
      const src = cur.state.bottles[from]!;
      // A capped (finished) tube can't be poured from — same rule the player plays under.
      if (src.length === 0 || isCapped(src, cur.state.capacity, cur.hidden[from])) continue;
      const cap = knownTopRun(src, cur.hidden[from]);
      const srcUniform = src.every((c) => c === src[0]);
      const srcConcealed = cur.hidden[from]?.some(Boolean) ?? false;
      for (let to = 0; to < n; to++) {
        if (from === to) continue;
        const dst = cur.state.bottles[to]!;
        if (dst.length === 0) {
          if (to !== firstEmpty) continue; // empties are interchangeable
          // Relocating a fully-revealed solid block to an empty tube is never progress.
          if (srcUniform && !srcConcealed) continue;
        }
        if (!canPour(cur.state, from, to)) continue;
        const { state: next } = pour(cur.state, from, to, cap);
        const nextHidden = revealExposed(next, cur.hidden);
        const nextKey = stateKey(next, nextHidden);
        const ng = cur.g + 1;
        if (ng < (bestG.get(nextKey) ?? Infinity)) {
          bestG.set(nextKey, ng);
          heap.push({ state: next, hidden: nextHidden, g: ng, f: ng + runsHeuristic(next), key: nextKey });
        }
      }
    }
  }
  return null;
}
