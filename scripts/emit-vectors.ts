/**
 * Emits the language-neutral conformance vectors (`vectors/*.json`) that both the JS core and
 * the Rust core (`core/`) test against — the G1 leg of the Track F `exe/test` gate. JS is the
 * oracle while it remains authoritative (through F4), so vectors are generated FROM the JS
 * implementations and asserted by both sides; a rule change means re-emitting the vectors,
 * forcing both implementations to move together.
 *
 * F0 scope: the mulberry32 stream (every seeded system flows through it, so rng parity is the
 * precondition for all other parity). Engine/mechanic vectors join in F1.
 *
 * Usage: npm run vectors:emit
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSlots, compositeScores, measureMetrics, type Metrics } from '../src/game/difficulty';
import { pour } from '../src/game/engine';
import { computeFunnels, funnelEligibleTubes } from '../src/game/funnels';
import { generateLevel } from '../src/game/generator';
import { PALETTE } from '../src/game/generator';
import { cappedSolveMoves, computeHidden, exposableCells } from '../src/game/hidden';
import { buildIce } from '../src/game/ice';
import { seedForLevel, targetPercentile } from '../src/game/progression';
import { mulberry32 } from '../src/game/rng';
import { hintMove, nearOptimalCutoffs, optimalCappedMoves } from '../src/game/search';
import { bfsOptimal, usefulMoves } from '../src/game/solver';
import type { GameState, Move, ParMode } from '../src/game/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const RNG_SEEDS = [0, 1, 42, 123456789, 2147483647, 0xdeadbeef, 4294967295];
const RNG_DRAWS = 8;

/**
 * Draws are stored as the underlying u32 (`float * 2^32`, exact — mulberry32's float is
 * u32/2^32 by construction), NOT as the float. Floats in JSON are a 1-ulp trap: serde_json's
 * default parser is not correctly rounded (that's its opt-in `float_roundtrip` feature), and
 * any other consumer could stumble the same way. Integers are parse-exact everywhere.
 */
const rngVectors = {
  description:
    'mulberry32(seed) first draws as raw u32 (js float = draw / 2^32), generated from ' +
    'src/game/rng.ts (the oracle). Asserted by src/game/rng.vectors.test.ts and ' +
    'core/tests/rng_vectors.rs.',
  mulberry32: RNG_SEEDS.map((seed) => {
    const rng = mulberry32(seed);
    return { seed, draws: Array.from({ length: RNG_DRAWS }, () => rng() * 4294967296) };
  }),
};

mkdirSync(join(ROOT, 'vectors'), { recursive: true });
const rngOut = join(ROOT, 'vectors/rng.json');
writeFileSync(rngOut, JSON.stringify(rngVectors, null, 2) + '\n');
console.log(`wrote ${rngOut}`);

// ---------------------------------------------------------------------------------------------
// Solver/generator conformance vectors (`vectors/solver.json`) — the F1 differential core.
// Each case pins, for one seeded footprint: the generated board + DFS solution (generator +
// solver + rng parity in one), the three mechanic overlays, the capped-search results, and a
// replay trace of per-step useful-move sets (the G2 seed). Colors are palette INDICES; hidden
// grids are per-tube bitmasks (bit i = cell i concealed); ice is (trigger, height) per tube.
// ---------------------------------------------------------------------------------------------

/** Footprints spanning the campaign's shape families (see progression.ts SHAPES). */
const SOLVER_CASES: {
  colors: number;
  bottles: number;
  capacity: number;
  seed: number;
  minPar?: number;
  parMode?: ParMode;
}[] = [
  { colors: 3, bottles: 5, capacity: 4, seed: 101 },
  { colors: 4, bottles: 5, capacity: 4, seed: 202, parMode: 'optimal' },
  { colors: 4, bottles: 5, capacity: 4, seed: 303, minPar: 12 },
  { colors: 3, bottles: 5, capacity: 6, seed: 404 },
  { colors: 4, bottles: 5, capacity: 8, seed: 505 },
  { colors: 4, bottles: 5, capacity: 10, seed: 606 },
  { colors: 7, bottles: 10, capacity: 4, seed: 707 },
  { colors: 8, bottles: 10, capacity: 4, seed: 808, minPar: 20 },
  { colors: 11, bottles: 15, capacity: 4, seed: 909 },
  { colors: 12, bottles: 15, capacity: 4, seed: 1010 },
];

const CAPPED_BUDGET = 500_000;
const CUTOFF_BUDGET = 500_000;
const HINT_BUDGET = 200_000;
const TRACE_SAMPLE_EVERY = 5;

const colorIndex = (c: string): number => {
  const i = PALETTE.indexOf(c as (typeof PALETTE)[number]);
  if (i < 0) throw new Error(`unknown color ${c}`);
  return i;
};
const cellsOf = (state: GameState): number[][] => state.bottles.map((b) => b.map(colorIndex));
const moveOf = (m: Move) => ({ from: m.from, to: m.to, count: m.count, color: colorIndex(m.color) });
const maskOf = (col: boolean[]): number => col.reduce((acc, hid, i) => acc | (hid ? 1 << i : 0), 0);

/** Per-cell ice grid → per-tube (trigger, height), asserting the contiguous-bottom invariant. */
const iceTubesOf = (ice: readonly (readonly (string | null)[])[]) =>
  ice.map((col) => {
    const height = col.reduce<number>((acc, tint, i) => (tint != null ? i + 1 : acc), 0);
    for (let i = 0; i < height; i++) {
      if (col[i] == null || col[i] !== col[0]) throw new Error('ice block not contiguous/uniform');
    }
    return height === 0 ? { trigger: null, height: 0 } : { trigger: colorIndex(col[0]!), height };
  });

const solverCases = SOLVER_CASES.map((options) => {
  const level = generateLevel({ ...options, parMode: options.parMode ?? 'proxy' });
  const { state, solution, seed } = level;

  const hidden = computeHidden(state, seed, exposableCells(state, solution));
  const funnels = computeFunnels(state, seed, funnelEligibleTubes(state, solution));
  const ice = buildIce(state, solution, hidden, seed);
  const overlays = { funnels, ice };

  const cutoffs = nearOptimalCutoffs(state, hidden, CUTOFF_BUDGET, overlays);
  const hint = hintMove(state, hidden, overlays, HINT_BUDGET);

  // Replay trace (G2 seed): per bulk-solution step, the useful-move set; sampled full boards.
  const trace: { step: number; usefulMoves: number[][]; cells?: number[][] }[] = [];
  let cur = state;
  solution.forEach((m, step) => {
    trace.push({
      step,
      usefulMoves: usefulMoves(cur, overlays).map(({ from, to }) => [from, to]),
      ...(step % TRACE_SAMPLE_EVERY === 0 ? { cells: cellsOf(cur) } : {}),
    });
    cur = pour(cur, m.from, m.to).state;
  });

  return {
    options: {
      colors: options.colors,
      bottles: options.bottles,
      capacity: options.capacity,
      seed: options.seed,
      minPar: options.minPar ?? null,
      parMode: options.parMode ?? 'proxy',
    },
    state: cellsOf(state),
    solution: solution.map(moveOf),
    par: level.par,
    minMoves: level.minMoves,
    bfsOptimal: bfsOptimal(state),
    hidden: hidden.map(maskOf),
    cappedSolveMoves: cappedSolveMoves(state, solution, hidden),
    funnels: funnels.map((t) => (t == null ? null : colorIndex(t))),
    ice: iceTubesOf(ice),
    cappedBudget: CAPPED_BUDGET,
    optimalCapped: optimalCappedMoves(state, hidden, CAPPED_BUDGET, overlays),
    cutoffBudget: CUTOFF_BUDGET,
    cutoffs: cutoffs ? { optimal: cutoffs.optimal, twoStarMax: cutoffs.twoStarMax } : null,
    hintBudget: HINT_BUDGET,
    hint: hint ? [hint.from, hint.to] : null,
    finalCells: cellsOf(cur),
    trace,
  };
});

const solverVectors = {
  description:
    'Seeded generator/solver/mechanic conformance cases, generated from the JS core (the ' +
    'oracle) by scripts/emit-vectors.ts. Colors are palette indices; hidden = per-tube ' +
    'bitmasks; ice = per-tube (trigger, height). Asserted by core/tests/conformance.rs and ' +
    'src/game/solver.vectors.test.ts.',
  cases: solverCases,
};

const solverOut = join(ROOT, 'vectors/solver.json');
writeFileSync(solverOut, JSON.stringify(solverVectors, null, 2) + '\n');
console.log(`wrote ${solverOut} (${solverCases.length} cases)`);

// ---------------------------------------------------------------------------------------------
// Difficulty/progression conformance vectors (`vectors/difficulty.json`). Metrics, composite
// scores, and slot assignment are exact IEEE arithmetic replayed in identical operation order,
// so floats are pinned BIT-EXACTLY — serialized as u64-bit decimal strings (never raw JSON
// floats; see the rng vectors' 1-ulp lesson). `targetPercentile` goes through Math.pow, which
// is not correctly rounded in either language, so the Rust side compares it with tolerance.
// ---------------------------------------------------------------------------------------------

const bitsOf = (x: number): string => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString();
};

const METRIC_OPTS = {
  optimalNodeBudget: 200_000,
  tierNodeBudget: 200_000,
  deadEndSamples: 24,
  deadEndNodeBudget: 50_000,
};

const familyOf = (bottles: number, capacity: number): string =>
  bottles === 15 ? 'large' : bottles === 10 ? 'medium' : capacity > 4 ? 'tall' : 'small';

const metricsPool: Metrics[] = [];
const difficultyCases = SOLVER_CASES.map((options) => {
  const level = generateLevel({ ...options, parMode: options.parMode ?? 'proxy' });
  const { state, solution, seed } = level;
  const hidden = computeHidden(state, seed, exposableCells(state, solution));
  const funnels = computeFunnels(state, seed, funnelEligibleTubes(state, solution));
  const ice = buildIce(state, solution, hidden, seed);
  const metrics = measureMetrics(
    state,
    hidden,
    solution,
    { ...METRIC_OPTS, deadEndSeed: seed },
    { funnels, ice },
  );
  metricsPool.push(metrics);
  return {
    seed: options.seed,
    metrics: {
      optimal: metrics.optimal,
      optimalExact: metrics.optimalExact,
      twoStarMax: metrics.twoStarMax,
      forcedMoveRatioBits: bitsOf(metrics.forcedMoveRatio),
      deadEndDensityBits: bitsOf(metrics.deadEndDensity),
      digDepthBits: bitsOf(metrics.digDepth),
      funnelLoadBits: bitsOf(metrics.funnelLoad),
      iceLoadBits: bitsOf(metrics.iceLoad),
      colors: metrics.colors,
      empties: metrics.empties,
    },
    family: familyOf(options.bottles, options.capacity),
  };
});

const scores = compositeScores(metricsPool);
const slotTargets = [0.05, 0.15, 0.3, 0.45, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0];
const slotPicks = assignSlots(
  difficultyCases.map((c, i) => ({ score: scores[i]!, family: c.family })),
  slotTargets,
);

const difficultyVectors = {
  description:
    'Difficulty/progression conformance, generated from the JS core (the oracle) by ' +
    'scripts/emit-vectors.ts. Float fields are f64 bit patterns as u64 decimal strings ' +
    '(bit-exact); targetPercentile goes through Math.pow and is tolerance-compared. ' +
    'Asserted by core/tests/difficulty_vectors.rs.',
  metricOptions: METRIC_OPTS,
  cases: difficultyCases,
  compositeScoreBits: scores.map(bitsOf),
  slotTargets: slotTargets.map(bitsOf),
  slotPicks,
  seedForLevel: [
    ...[1, 2, 60, 61, 120, 240, 241, 999].map((level) => ({ level, salt: 0 })),
    ...[1, 7].map((level) => ({ level, salt: 3 })),
    // The bake's pool seeds (50_000 + chapter*100 + shapeIndex) and overlay tags.
    ...[50_000, 50_105, 50_309, 1_000_000, 3_090_079].map((level) => ({ level, salt: 0 })),
  ].map(({ level, salt }) => ({ level, salt, seed: seedForLevel(level, salt) })),
  targetPercentileBits: Array.from({ length: 240 }, (_, i) => bitsOf(targetPercentile(i + 1))),
};

const difficultyOut = join(ROOT, 'vectors/difficulty.json');
writeFileSync(difficultyOut, JSON.stringify(difficultyVectors, null, 2) + '\n');
console.log(`wrote ${difficultyOut} (${difficultyCases.length} cases)`);
