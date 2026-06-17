/**
 * Level generator. Produces boards that are **guaranteed solvable** by shuffling a
 * balanced multiset of color segments and then verifying with the solver (rejection
 * sampling). Every returned level carries a concrete solution and its step count.
 *
 * A naive random-pour walk from the solved board does NOT guarantee solvability:
 * pouring same-color-onto-same-color merges runs and loses the split point, so the
 * walk isn't reversible. Verifying with a real solver sidesteps that entirely.
 */
import { isComplete, isWon } from './engine';
import { mulberry32 } from './rng';
import { bfsOptimal, solve } from './solver';
import type { GameState, GeneratedLevel, Move, ParMode } from './types';

// Re-exported for callers that historically imported the PRNG from here; its home is now rng.ts.
export { mulberry32 };

/** Default palette ids (see ../theme/colors.ts). Generation uses the first N. */
export const PALETTE: readonly string[] = [
  'ruby',
  'amethyst',
  'sapphire',
  'emerald',
  'amber',
  'rose',
  'teal',
  'violet',
  'lime',
  'tangerine',
  'cobalt',
  'magenta',
];

export const DEFAULT_CAPACITY = 4;
const MAX_COLORS = PALETTE.length; // 12
const MAX_RETRIES = 300;
/**
 * When a `minPar` floor is requested, stop *hunting for a harder board* after this many
 * solvable candidates and keep the most-tangled one seen. Bounds the extra solver work so
 * generation never churns — the floor is a preference, not a hard requirement.
 */
const PAR_SAMPLE_CAP = 50;

/**
 * Whether a (colors, bottles, capacity) combo is in the known-good, efficiently
 * solvable space. Requires at least one empty bottle and caps colors at the palette
 * size. Note: with only 1 empty, random shuffles are frequently unsolvable, so the
 * generator's rejection sampling churns — callers should prefer >= 2 empties for fast,
 * reliable generation (see the tier presets in levels.ts).
 */
export function isValidCombo(colors: number, bottles: number, capacity = DEFAULT_CAPACITY): boolean {
  if (!Number.isInteger(colors) || !Number.isInteger(bottles)) return false;
  if (capacity < 2) return false;
  if (colors < 2 || colors > MAX_COLORS) return false;
  const empties = bottles - colors;
  return empties >= 1;
}

/** Fisher–Yates shuffle using the provided PRNG (in place). */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Deal a flat list of segments into `colors` full bottles, leaving `empties` empty. */
function deal(segments: string[], colors: number, empties: number, capacity: number): GameState {
  const bottles: string[][] = [];
  for (let i = 0; i < colors; i++) {
    bottles.push(segments.slice(i * capacity, i * capacity + capacity));
  }
  for (let i = 0; i < empties; i++) bottles.push([]);
  return { bottles, capacity };
}

/** A board is too easy if it's already won or has a pre-completed color bottle. */
function isDegenerate(state: GameState): boolean {
  if (isWon(state)) return true;
  return state.bottles.some((b) => b.length > 0 && isComplete(b, state.capacity));
}

export interface GenerateOptions {
  colors: number;
  bottles: number;
  capacity?: number;
  /** Seed for reproducibility. Defaults to a random seed. */
  seed?: number;
  /**
   * Reject boards easier than this par (best-of-N rejection sampling). The floor is a
   * preference: if no board reaches it within the sampling budget, the hardest one found is
   * returned anyway, so generation never fails on account of the floor. Omit for the legacy
   * "accept first solvable" behavior.
   */
  minPar?: number;
  /** How to measure par for the floor / the returned `par`. Defaults to `proxy`. */
  parMode?: ParMode;
}

/**
 * Measure a board's par. `optimal` runs the exact BFS (falling back to the DFS length if it
 * hits the node cap); `proxy` just uses the DFS solution length.
 */
function measurePar(state: GameState, solution: Move[], mode: ParMode): number {
  if (mode === 'optimal') {
    const optimal = bfsOptimal(state);
    if (optimal !== null) return optimal;
  }
  return solution.length;
}

/**
 * Generate a verified-solvable level. Throws if the combo is invalid, or (extremely
 * unlikely) if no solvable board is found within the retry cap.
 */
export function generateLevel(options: GenerateOptions): GeneratedLevel {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const { colors, bottles } = options;

  if (!isValidCombo(colors, bottles, capacity)) {
    throw new Error(`Invalid combo: ${colors} colors / ${bottles} bottles / cap ${capacity}`);
  }

  const empties = bottles - colors;
  const baseSeed = options.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const parMode: ParMode = options.parMode ?? 'proxy';
  const minPar = options.minPar;
  const rng = mulberry32(baseSeed);

  // The balanced multiset: `capacity` copies of each of the first `colors` palette ids.
  const template: string[] = [];
  for (let c = 0; c < colors; c++) {
    for (let k = 0; k < capacity; k++) template.push(PALETTE[c]!);
  }

  const build = (state: GameState, solution: Move[]): GeneratedLevel => ({
    state,
    colors,
    bottles,
    capacity,
    solution,
    minMoves: solution.length,
    par: measurePar(state, solution, parMode),
    seed: baseSeed,
  });

  // Best-of-N: the hardest solvable board seen so far, for the par-floor path's fallback.
  let best: GeneratedLevel | null = null;
  let solvableSeen = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const state = deal(shuffle([...template], rng), colors, empties, capacity);
    if (isDegenerate(state)) continue;

    const solution = solve(state);
    if (!solution) continue;

    // Legacy fast path: no floor requested, accept the first solvable board.
    if (minPar === undefined) return build(state, solution);

    const candidate = build(state, solution);
    if (best === null || candidate.par > best.par) best = candidate;
    if (candidate.par >= minPar) return candidate; // met the floor — done.

    // Give up hunting for a harder board once we've sampled enough; keep the best.
    if (++solvableSeen >= PAR_SAMPLE_CAP) return best;
  }

  if (best) return best;
  throw new Error(
    `Failed to generate a solvable ${colors}/${bottles} level after ${MAX_RETRIES} attempts`,
  );
}
