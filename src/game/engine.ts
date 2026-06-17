/**
 * Pure rules engine for the color-sort puzzle. Every function here is side-effect free
 * and immutable: `pour` returns a brand new `GameState` rather than mutating its input,
 * which keeps undo history and React rendering simple.
 */
import type { Bottle, Color, GameState, Move } from './types';

/** The top (pourable) color of a bottle, or `null` if the bottle is empty. */
export function topColor(bottle: Bottle): Color | null {
  return bottle.length > 0 ? bottle[bottle.length - 1]! : null;
}

/** How many contiguous segments of the same color sit at the top of the bottle. */
export function topRunLength(bottle: Bottle): number {
  if (bottle.length === 0) return 0;
  const color = bottle[bottle.length - 1]!;
  let run = 1;
  for (let i = bottle.length - 2; i >= 0; i--) {
    if (bottle[i] === color) run++;
    else break;
  }
  return run;
}

/** Empty slots remaining in a bottle. */
export function freeSpace(bottle: Bottle, capacity: number): number {
  return capacity - bottle.length;
}

/** True when a bottle is empty, or full and a single solid color. */
export function isComplete(bottle: Bottle, capacity: number): boolean {
  if (bottle.length === 0) return true;
  if (bottle.length !== capacity) return false;
  const first = bottle[0];
  return bottle.every((c) => c === first);
}

/**
 * Whether a pour from `from` to `to` is legal:
 * different bottles, source non-empty, target has room, and the colors match
 * (or the target is empty).
 */
export function canPour(state: GameState, from: number, to: number): boolean {
  if (from === to) return false;
  const src = state.bottles[from];
  const dst = state.bottles[to];
  if (!src || !dst) return false;
  if (src.length === 0) return false;
  if (freeSpace(dst, state.capacity) <= 0) return false;
  const dstTop = topColor(dst);
  return dstTop === null || dstTop === topColor(src);
}

/**
 * How many segments would actually move on a `from -> to` pour: the smaller of the
 * source's top run and the target's free space. Returns 0 if the pour is illegal.
 */
export function pourAmount(state: GameState, from: number, to: number): number {
  if (!canPour(state, from, to)) return 0;
  const src = state.bottles[from]!;
  const dst = state.bottles[to]!;
  return Math.min(topRunLength(src), freeSpace(dst, state.capacity));
}

/**
 * Apply a pour, returning the resulting state and the executed move.
 * Throws if the pour is illegal — callers should gate with `canPour` first.
 *
 * `maxCount` caps how many segments move (default: the full top run). The hidden-colors
 * mechanic uses it to limit a pour to the player-visible run; the engine itself stays
 * unaware of concealment.
 */
export function pour(
  state: GameState,
  from: number,
  to: number,
  maxCount = Infinity,
): { state: GameState; move: Move } {
  const count = Math.min(pourAmount(state, from, to), maxCount);
  if (count <= 0) {
    throw new Error(`Illegal pour from ${from} to ${to}`);
  }
  const src = state.bottles[from]!;
  const dst = state.bottles[to]!;
  const color = topColor(src)!;

  const newSrc = src.slice(0, src.length - count);
  const newDst = [...dst, ...Array<Color>(count).fill(color)];

  const bottles = state.bottles.map((bottle, i) => {
    if (i === from) return newSrc;
    if (i === to) return newDst;
    return bottle;
  });

  return { state: { ...state, bottles }, move: { from, to, count, color } };
}

/** A level is won when every bottle is complete (empty or a single full color). */
export function isWon(state: GameState): boolean {
  return state.bottles.every((b) => isComplete(b, state.capacity));
}

/** Enumerate every legal pour available from a state. */
export function legalMoves(state: GameState): Array<{ from: number; to: number }> {
  const moves: Array<{ from: number; to: number }> = [];
  const n = state.bottles.length;
  for (let from = 0; from < n; from++) {
    for (let to = 0; to < n; to++) {
      if (canPour(state, from, to)) moves.push({ from, to });
    }
  }
  return moves;
}

/** Deadlock: not won, and no legal move remains (the "no moves left" alert). */
export function isDeadlocked(state: GameState): boolean {
  return !isWon(state) && legalMoves(state).length === 0;
}
