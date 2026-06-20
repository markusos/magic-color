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
import { bfsOptimal, canonical, solve } from './solver';
import type { Color, GameState, GeneratedLevel, Move, ParMode } from './types';

// Re-exported for callers that historically imported the PRNG from here; its home is now rng.ts.
export { mulberry32 };

/** Default palette ids (see ../theme/colors.ts). Generation uses the first N. */
export const PALETTE: readonly Color[] = [
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
].map((id) => id as Color);

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
 * solvable space. Requires at least one tube's worth of free space and caps colors at the
 * palette size. Note: with only 1 tube of slack, random layouts are frequently unsolvable,
 * so the generator's rejection sampling churns — callers should prefer >= 2 spare tubes for
 * fast, reliable generation (see the tier presets in levels.ts).
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

/**
 * Build a randomized fill profile: how many segments each of `bottles` tubes starts with.
 * The fills sum to the total liquid (`colors * capacity`) and each sits in [0, capacity], so
 * the board still resolves into `colors` complete bottles.
 *
 * Unlike the old "full tubes plus trailing empties" layout, this scatters partially filled and
 * empty tubes for variety: a random number of tubes (0..empties) are left completely empty, and
 * whatever free space is left over is sprinkled across the remaining tubes as partial fills.
 * Picking the reserved-empty count freshly each attempt also keeps generation robust — when a
 * sparse, partial-heavy layout turns out unsolvable, a later attempt may reserve more empties and
 * fall back toward the easy classic shape. Tube positions are shuffled so empties land anywhere.
 */
function randomFillProfile(
  colors: number,
  bottles: number,
  capacity: number,
  rng: () => number,
): number[] {
  const empties = bottles - colors;
  const freeSpace = empties * capacity;

  // Reserve a random number of fully-empty tubes. Reserving more keeps the board easier and
  // generation more reliable; reserving fewer trades that for partial-tube variety.
  const reserved = Math.floor(rng() * (empties + 1));

  const fills = new Array<number>(bottles).fill(capacity);
  for (let i = 0; i < reserved; i++) fills[i] = 0;

  // Spread the leftover free space across the non-reserved tubes as partial fills, keeping each
  // of them at >= 1 segment so the empty-tube count stays exactly `reserved`.
  let toRemove = freeSpace - reserved * capacity;
  while (toRemove > 0) {
    const i = reserved + Math.floor(rng() * (bottles - reserved));
    if (fills[i]! > 1) {
      fills[i]!--;
      toRemove--;
    }
  }

  return shuffle(fills, rng);
}

/** Deal a flat list of segments into bottles sized by `fills` (segments must sum to the fills). */
function deal(segments: Color[], fills: number[], capacity: number): GameState {
  const bottles: Color[][] = [];
  let offset = 0;
  for (const fill of fills) {
    bottles.push(segments.slice(offset, offset + fill));
    offset += fill;
  }
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

/** The balanced multiset for a footprint: `capacity` copies of each of the first `colors` ids. */
function colorTemplate(colors: number, capacity: number): Color[] {
  const template: Color[] = [];
  for (let c = 0; c < colors; c++) {
    for (let k = 0; k < capacity; k++) template.push(PALETTE[c]!);
  }
  return template;
}

/**
 * One generation attempt: scatter the template into a random fill profile and verify solvability.
 * Returns the board and a proof solution, or `null` if the layout is degenerate or unsolvable.
 * Shared by `generateLevel` (rejection sampling) and `generateCandidates` (offline bake).
 */
function attemptBoard(
  template: Color[],
  colors: number,
  bottles: number,
  capacity: number,
  rng: () => number,
): { state: GameState; solution: Move[] } | null {
  const fills = randomFillProfile(colors, bottles, capacity, rng);
  const state = deal(shuffle([...template], rng), fills, capacity);
  if (isDegenerate(state)) return null;
  const solution = solve(state);
  if (!solution) return null;
  return { state, solution };
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

  const baseSeed = options.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const parMode: ParMode = options.parMode ?? 'proxy';
  const minPar = options.minPar;
  const rng = mulberry32(baseSeed);
  const template = colorTemplate(colors, capacity);

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
    const board = attemptBoard(template, colors, bottles, capacity, rng);
    if (!board) continue;
    const { state, solution } = board;

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

/**
 * Collect up to `count` distinct, verified-solvable boards for a footprint — the candidate pool the
 * offline bake (`scripts/build-levels.ts`) scores and selects from. Unlike `generateLevel`, this
 * does not stop at the first acceptable board: it keeps sampling so a difficulty scorer can choose
 * the best fit for a target curve. Deduplicates by canonical board key, and bounds total work with
 * `maxAttempts` so an over-large `count` can never spin forever (returns however many it found).
 *
 * Par here is the cheap proxy (solution length); the bake computes its own exact difficulty metrics
 * per candidate, so paying for `optimal` par on every sampled board would be wasted work.
 */
export function generateCandidates(
  options: Pick<GenerateOptions, 'colors' | 'bottles' | 'capacity' | 'seed'>,
  count: number,
  maxAttempts = count * 40,
): GeneratedLevel[] {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const { colors, bottles } = options;
  if (!isValidCombo(colors, bottles, capacity)) {
    throw new Error(`Invalid combo: ${colors} colors / ${bottles} bottles / cap ${capacity}`);
  }

  const rng = mulberry32(options.seed ?? (Math.random() * 2 ** 32) >>> 0);
  const template = colorTemplate(colors, capacity);

  const seen = new Set<string>();
  const candidates: GeneratedLevel[] = [];
  for (let attempt = 0; attempt < maxAttempts && candidates.length < count; attempt++) {
    const board = attemptBoard(template, colors, bottles, capacity, rng);
    if (!board) continue;
    const key = canonical(board.state);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      state: board.state,
      colors,
      bottles,
      capacity,
      solution: board.solution,
      minMoves: board.solution.length,
      par: board.solution.length,
      seed: options.seed ?? 0,
    });
  }
  return candidates;
}
