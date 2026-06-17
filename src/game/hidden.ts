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
import { isComplete, pour } from './engine';
import { mulberry32 } from './rng';
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
  // Full + single-color is exactly `isComplete` for a non-empty bottle; capping additionally
  // requires every cell revealed (a tube hiding a "?" can still be poured to surface it).
  if (bottle.length !== capacity) return false;
  return isComplete(bottle, capacity) && !hiddenCol?.some(Boolean);
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
