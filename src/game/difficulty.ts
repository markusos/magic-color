/**
 * Offline difficulty metrics, the size-normalized difficulty SCORE, and slot assignment for the
 * level bake (`scripts/build-levels.ts`). None of this runs in the app — it's the extra compute we
 * can afford once generation moves off the player's device: measure each candidate precisely, score
 * it on a size-decoupled scale, then assign boards to the difficulty curve with shape variety.
 *
 * Why a composite (not just optimal moves): raw move count is dominated by board size (more colors ⇒
 * more moves), so ranking by it just recreates a tube-count ladder. The score blends mostly
 * size-independent signals so a tricky 5-tube board can outrank a sprawling 15-tube one (see
 * PLAN.md, "Revised model v2").
 */
import { isWon, pour } from './engine';
import { cappedSolveMoves, type HiddenGrid } from './hidden';
import { mulberry32 } from './rng';
import { optimalCappedMoves } from './search';
import { isUnsolvable, usefulMoves } from './solver';
import type { GameState, Move } from './types';

/**
 * Offline node budget for the exact-optimal A*. Far above the runtime's 12k cap (we're not on a
 * phone here): big/tangled boards still overflow and fall back to the proxy, but most resolve
 * exactly.
 */
export const OPTIMAL_NODE_BUDGET = 200_000;

/** Per-candidate difficulty measurements. */
export interface Metrics {
  /** Exact hidden-aware optimal player pours, or a proxy upper bound if the A* overflowed. */
  optimal: number;
  /** Whether `optimal` is the exact A* result (false ⇒ proxy fallback was used). */
  optimalExact: boolean;
  /** Fraction of solution-path states with ≤1 useful move. Lower ⇒ more choices ⇒ harder. */
  forcedMoveRatio: number;
  /** Fraction of random playouts that wander into an unrecoverable state. Higher ⇒ more punishing. */
  deadEndDensity: number;
  /** Concealment burden (0 for non-hidden boards): how buried the "?"s are, size-normalized. */
  digDepth: number;
  /** Distinct colors on the board (for size normalization). */
  colors: number;
  /** Spare tubes (`bottles - colors`) — the slack budget (for the tightness term). */
  empties: number;
}

export interface MetricOptions {
  /** Node budget for the exact-optimal A*. */
  optimalNodeBudget?: number;
  /** Random playouts for the dead-end estimate (0 disables; deadEndDensity becomes 0). */
  deadEndSamples?: number;
  /** Node budget for each dead-end solvability check (a hit cap counts as "not proven dead"). */
  deadEndNodeBudget?: number;
  /** Seed for the dead-end sampling RNG (keeps the bake deterministic). */
  deadEndSeed?: number;
}

/**
 * Fraction of states along the (full-information) solution that have at most one useful move — a
 * board that railroads you through forced moves is easier than one that constantly offers (and
 * punishes) choices. Measured against `usefulMoves`, the same pruned branching the solver explores.
 */
function forcedMoveRatio(state: GameState, solution: Move[]): number {
  let current = state;
  let forced = 0;
  let total = 0;
  for (const move of solution) {
    if (usefulMoves(current).length <= 1) forced++;
    total++;
    current = pour(current, move.from, move.to).state;
  }
  return total === 0 ? 1 : forced / total;
}

/**
 * Estimate how easily a board punishes mistakes: play `samples` short random lines of *useful* moves
 * and measure the fraction that land in a provably unsolvable state. A board where many casual move
 * orders dead-end "feels hard" independently of its size — the strongest such signal we have, and
 * affordable only offline (each check is a full solver search). Uses full-information state, so under
 * concealment the real difficulty is a touch higher (a safe, conservative direction).
 */
function deadEndDensity(
  state: GameState,
  solutionLen: number,
  samples: number,
  nodeBudget: number,
  seed: number,
): number {
  if (samples <= 0) return 0;
  const rng = mulberry32(seed >>> 0);
  // Wander roughly partway into the game — long enough to reach risky territory, short enough that
  // many lines are still recoverable, so the fraction discriminates between boards.
  const steps = Math.max(2, Math.round(solutionLen * 0.4));

  let dead = 0;
  for (let s = 0; s < samples; s++) {
    let current = state;
    for (let k = 0; k < steps; k++) {
      const moves = usefulMoves(current);
      if (moves.length === 0) break;
      const mv = moves[Math.floor(rng() * moves.length)]!;
      current = pour(current, mv.from, mv.to).state;
      if (isWon(current)) break;
    }
    if (!isWon(current) && isUnsolvable(current, { maxNodes: nodeBudget })) dead++;
  }
  return dead / samples;
}

/**
 * Concealment burden of a hidden board (0 when nothing is concealed): the total liquid stacked on top
 * of (and including) each "?", normalized by board size. A cell buried deeper forces more digging to
 * surface it, so deeper/denser concealment scores higher. Size-decoupled (a ratio), so it captures
 * the hidden chapter's signature difficulty without just tracking board size. Exported for unit tests.
 */
export function digDepth(state: GameState, hidden: HiddenGrid): number {
  const cap = state.capacity;
  let total = 0;
  let sum = 0;
  state.bottles.forEach((bottle, b) => {
    total += bottle.length;
    const col = hidden[b];
    for (let i = 0; i < bottle.length; i++) {
      // (bottle.length - i) = the "?" itself plus every cell stacked above it — the cost to dig it out.
      if (col?.[i]) sum += (bottle.length - i) / cap;
    }
  });
  return total === 0 ? 0 : sum / total;
}

/** Measure a candidate board's difficulty metrics. */
export function measureMetrics(
  state: GameState,
  hidden: HiddenGrid,
  solution: Move[],
  opts: MetricOptions = {},
): Metrics {
  const colors = new Set<string>(state.bottles.flat()).size;
  const exact = optimalCappedMoves(state, hidden, opts.optimalNodeBudget ?? OPTIMAL_NODE_BUDGET);
  const optimal = exact ?? cappedSolveMoves(state, solution, hidden);
  return {
    optimal,
    optimalExact: exact !== null,
    forcedMoveRatio: forcedMoveRatio(state, solution),
    deadEndDensity: deadEndDensity(
      state,
      solution.length,
      opts.deadEndSamples ?? 24,
      opts.deadEndNodeBudget ?? 50_000,
      opts.deadEndSeed ?? 1,
    ),
    digDepth: digDepth(state, hidden),
    colors,
    empties: state.bottles.length - colors,
  };
}

/**
/**
 * Phase-3 tuning dials: how much each ~[0,1] signal contributes to the composite difficulty score.
 * Dead-end density is the strongest "feels hard" signal so it's favored; tightness is mostly a
 * per-SHAPE constant (not a per-board signal), so it's down-weighted to let the per-board terms drive
 * selection. Started as an equal blend (all 1) — these are the knobs to retune from playtests.
 */
export const SCORE_WEIGHTS = {
  deadEnd: 1.5,
  forced: 1,
  movesPerColor: 1,
  tightness: 0.6,
  digDepth: 1,
} as const;

/**
 * The size-normalized difficulty score for every candidate in a pool, each in ~[0,1]. A weighted
 * blend (`SCORE_WEIGHTS`) of: dead-end density, inverted forced-move ratio, normalized moves-per-color
 * (`optimal / colors`, min-max scaled within the pool), tightness (`1 − empties/colors`), and dig
 * depth (concealment burden — 0 across a non-hidden pool, so it only shapes the hidden chapter). The
 * move term is normalized so it contributes *relative* depth rather than raw size.
 */
export function compositeScores(pool: Metrics[]): number[] {
  if (pool.length === 0) return [];
  const movesPerColor = pool.map((m) => (m.colors > 0 ? m.optimal / m.colors : 0));
  const lo = Math.min(...movesPerColor);
  const hi = Math.max(...movesPerColor);
  const normMpc = (x: number) => (hi > lo ? (x - lo) / (hi - lo) : 0.5);
  const w = SCORE_WEIGHTS;
  const wSum = w.deadEnd + w.forced + w.movesPerColor + w.tightness + w.digDepth;

  return pool.map((m, i) => {
    const tightness = m.colors > 0 ? Math.max(0, Math.min(1, 1 - m.empties / m.colors)) : 0;
    const weighted =
      w.deadEnd * m.deadEndDensity +
      w.forced * (1 - m.forcedMoveRatio) +
      w.movesPerColor * normMpc(movesPerColor[i]!) +
      w.tightness * tightness +
      w.digDepth * m.digDepth;
    return weighted / wSum;
  });
}

/** A candidate as far as slot assignment cares: its difficulty score and its shape family. */
export interface Slotable {
  score: number;
  family: string;
}

/** Penalty (in score units) added when a candidate repeats the previous slot's family. */
const ROTATION_PENALTY = 0.05;

function quantile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[i]!;
}

/**
 * Assign one candidate to each curve slot. `targetPercentiles[s]` is where slot `s` should sit on
 * the chapter's difficulty distribution; we pick the unused candidate whose score is closest to that
 * percentile's score, preferring a *different* shape family than the previous slot (variety) and
 * never going below the previous slot's score (monotonic difficulty). The monotonicity constraint is
 * relaxed for a slot only if nothing else qualifies. Returns the chosen pool index per slot.
 */
export function assignSlots(pool: Slotable[], targetPercentiles: number[]): number[] {
  if (pool.length < targetPercentiles.length) {
    throw new Error(`assignSlots: pool (${pool.length}) smaller than slots (${targetPercentiles.length})`);
  }
  const sortedScores = pool.map((p) => p.score).sort((a, b) => a - b);
  const used = new Set<number>();
  let prevScore = -Infinity;
  let prevFamily: string | null = null;
  const result: number[] = [];

  for (const pct of targetPercentiles) {
    const target = quantile(sortedScores, pct);
    const pick = (requireMonotonic: boolean): number => {
      let best = -1;
      let bestCost = Infinity;
      for (let i = 0; i < pool.length; i++) {
        if (used.has(i)) continue;
        if (requireMonotonic && pool[i]!.score < prevScore) continue;
        let cost = Math.abs(pool[i]!.score - target);
        if (prevFamily !== null && pool[i]!.family === prevFamily) cost += ROTATION_PENALTY;
        if (cost < bestCost) {
          bestCost = cost;
          best = i;
        }
      }
      return best;
    };

    let idx = pick(true);
    if (idx === -1) idx = pick(false); // relax monotonicity rather than fail
    used.add(idx);
    result.push(idx);
    prevScore = pool[idx]!.score;
    prevFamily = pool[idx]!.family;
  }
  return result;
}
