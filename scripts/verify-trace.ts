/**
 * G2 conformance-trace validation, JS side (Track F drift gate). Replays the Rust core's
 * trace (`core` bin `trace` → trace.json) under the JS runtime rules, asserting at every
 * traced state:
 *
 *   1. TRANSITIONS: JS's own capped pour (run capped by `blockedColumns`, reveal on surface)
 *      reproduces Rust's next state EXACTLY (cells + concealment) — both along the golden
 *      line and on the random offshoots.
 *   2. MOVE-SET EQUALITY: Rust's capped-successor set equals the moves JS's player rules
 *      admit — computed here from PUBLIC primitives only (engine ops + mechanic interaction
 *      reads, the surface that survives the F5 deletion; deliberately no import of
 *      `search.ts`/`solver.ts` internals). Set drift in EITHER direction fails.
 *
 * O(traced moves) — no search, no wasm-in-loop — so it stays a seconds-fast gate leg.
 *
 * Usage: npx tsx scripts/verify-trace.ts <trace.json>
 */
import { readFileSync } from 'node:fs';
import { canPour, isComplete, pour, topColor } from '../src/game/engine';
import { funnelAccepts } from '../src/game/funnels';
import { PALETTE } from '../src/game/generator';
import { isCapped, knownTopRun, revealExposed, type HiddenGrid } from '../src/game/hidden';
import { blockedColumns, type OverlaySet } from '../src/game/mechanics';
import { toColor, toColors, type GameState } from '../src/game/types';

interface Step {
  cells: number[][];
  hidden: number[];
  moves: [number, number][];
  apply?: [number, number];
}

interface Offshoot {
  fromStep: number;
  mv: [number, number];
  cells: number[][];
  hidden: number[];
  moves: [number, number][];
}

interface Trace {
  id: string;
  capacity: number;
  funnels: (number | null)[];
  ice: (number | null)[][];
  steps: Step[];
  offshoots: Offshoot[];
}

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx scripts/verify-trace.ts <trace.json>');
  process.exit(2);
}
const traces = JSON.parse(readFileSync(path, 'utf8')) as Trace[];

const fail = (id: string, msg: string): never => {
  console.error(`FAIL ${id}: ${msg}`);
  process.exit(1);
};

const stateOf = (cells: number[][], capacity: number): GameState => ({
  bottles: cells.map((col) => toColors(col.map((i) => PALETTE[i]!))),
  capacity,
});
const maskOf = (col: readonly boolean[]): number =>
  col.reduce((acc, hid, i) => acc | (hid ? 1 << i : 0), 0);
const masksOf = (grid: HiddenGrid): number[] => grid.map(maskOf);
const cellsEqual = (state: GameState, cells: number[][]): boolean =>
  state.bottles.length === cells.length &&
  state.bottles.every(
    (col, b) => col.length === cells[b]!.length && col.every((c, i) => PALETTE.indexOf(c) === cells[b]![i]),
  );

/**
 * The moves JS's player rules admit from a state — the independent JS expression of the
 * capped-successor set, from public primitives: source not capped and its visible run
 * non-empty; destination pourable and funnel-accepting; interchangeable empties collapsed to
 * the first ACCEPTING empty; relocating a fully-revealed solid block to an empty pruned.
 */
function playerMoveSet(state: GameState, set: OverlaySet): [number, number][] {
  const out: [number, number][] = [];
  const blocked = blockedColumns(set, state);
  const n = state.bottles.length;
  for (let from = 0; from < n; from++) {
    const src = state.bottles[from]!;
    if (src.length === 0 || isCapped(src, state.capacity, blocked[from])) continue;
    if (knownTopRun(src, blocked[from]) === 0) continue;
    const srcColor = topColor(src)!;
    const srcUniform = src.every((c) => c === src[0]);
    const srcConcealed = blocked[from]!.some(Boolean);
    const firstEmpty = state.bottles.findIndex(
      (b, idx) => b.length === 0 && funnelAccepts(set.funnels, idx, srcColor),
    );
    for (let to = 0; to < n; to++) {
      if (from === to) continue;
      if (!canPour(state, from, to)) continue;
      if (!funnelAccepts(set.funnels, to, srcColor)) continue;
      if (state.bottles[to]!.length === 0) {
        if (to !== firstEmpty) continue;
        if (srcUniform && !srcConcealed) continue;
      }
      out.push([from, to]);
    }
  }
  return out;
}

/** Apply one capped player pour + reveal, the way the runtime does. */
function applyMove(
  state: GameState,
  set: OverlaySet,
  from: number,
  to: number,
  id: string,
  what: string,
): { state: GameState; set: OverlaySet } {
  const blocked = blockedColumns(set, state);
  const cap = knownTopRun(state.bottles[from]!, blocked[from]);
  if (cap <= 0) fail(id, `${what}: source ${from} has no pourable run`);
  if (!canPour(state, from, to)) fail(id, `${what}: illegal ${from}->${to}`);
  const next = pour(state, from, to, cap).state;
  return { state: next, set: { ...set, hidden: revealExposed(next, set.hidden) } };
}

const movesEqual = (a: [number, number][], b: [number, number][]): boolean =>
  a.length === b.length && a.every(([f, t], i) => b[i]![0] === f && b[i]![1] === t);

let states = 0;
let transitions = 0;

for (const trace of traces) {
  const { id, capacity } = trace;
  const root = trace.steps[0]!;
  let state = stateOf(root.cells, capacity);
  // Hidden grids are carried as masks; JS keeps boolean columns internally and compares masks.
  let set: OverlaySet = {
    hidden: state.bottles.map((col, b) => col.map((_, i) => (root.hidden[b]! & (1 << i)) !== 0)),
    funnels: trace.funnels.map((f) => (f == null ? null : toColor(PALETTE[f]!))),
    ice: trace.ice.map((col) => col.map((c) => (c == null ? null : toColor(PALETTE[c]!)))),
  };
  if (state.bottles.some((col) => col.length > 0 && isComplete(col, capacity)))
    fail(id, 'degenerate root'); // paranoia: the trace should never carry one

  const lineStates: { state: GameState; set: OverlaySet }[] = [];
  trace.steps.forEach((step, si) => {
    if (!cellsEqual(state, step.cells)) fail(id, `step ${si}: board diverged from Rust`);
    const jsMasks = masksOf(set.hidden);
    if (!jsMasks.every((m, b) => m === step.hidden[b]))
      fail(id, `step ${si}: concealment diverged from Rust`);
    const jsMoves = playerMoveSet(state, set);
    if (!movesEqual(jsMoves, step.moves))
      fail(
        id,
        `step ${si}: move-set drift — js [${jsMoves.join(' ')}] vs rust [${step.moves.join(' ')}]`,
      );
    states++;
    lineStates.push({ state, set });
    if (step.apply) {
      ({ state, set } = applyMove(state, set, step.apply[0], step.apply[1], id, `step ${si}`));
      transitions++;
    }
  });
  lineStates.push({ state, set });

  for (const [oi, shoot] of trace.offshoots.entries()) {
    const from = lineStates[shoot.fromStep]!;
    const applied = applyMove(from.state, from.set, shoot.mv[0], shoot.mv[1], id, `offshoot ${oi}`);
    if (!cellsEqual(applied.state, shoot.cells)) fail(id, `offshoot ${oi}: board diverged`);
    const jsMasks = masksOf(applied.set.hidden);
    if (!jsMasks.every((m, b) => m === shoot.hidden[b])) fail(id, `offshoot ${oi}: concealment diverged`);
    const jsMoves = playerMoveSet(applied.state, applied.set);
    if (!movesEqual(jsMoves, shoot.moves)) fail(id, `offshoot ${oi}: move-set drift`);
    states++;
    transitions++;
  }
}

console.log(
  `PASS: ${traces.length} traces — ${states} states move-set-equal, ${transitions} transitions exact`,
);
