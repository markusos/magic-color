/**
 * Cross-language validation of a Rust bake's output under the JS runtime rules — the first
 * standing version of the `exe/test` gate's G3 + G4 legs (Track F). Reads a bake --out
 * directory (levels.json + golden-lines.json) and asserts, per level:
 *
 *   G4 (static): board shape sane, no pre-completed tube (degenerate), `par >= 1`,
 *   `twoStarMax > optimal`, every `requiresPresence` mechanic of the level actually shows,
 *   and the overlay data deserializes through the SAME registry path the app loads baked
 *   levels with.
 *
 *   G3 (golden-line replay): the Rust core's optimal winning line, replayed under the JS
 *   player rules (pours capped to the visible run via `blockedColumns`, reveals on surfacing,
 *   funnel gate, frozen cells) must be fully legal and win in EXACTLY `optimal` pours. This
 *   is the check that kills "committed optimal unreachable under JS rules" instantly.
 *
 * Usage: npx tsx scripts/verify-bake.ts <bake-out-dir>
 * Exits non-zero naming the first offending level.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canPour, isWon, pour, topColor } from '../src/game/engine';
import { funnelAccepts } from '../src/game/funnels';
import { anyHidden, isCapped, knownTopRun, revealExposed } from '../src/game/hidden';
import { anyFrozen, anyIce } from '../src/game/ice';
import { anyFunnel } from '../src/game/funnels';
import { blockedColumns, deserializeOverlays, type OverlaySet } from '../src/game/mechanics';
import { isComplete } from '../src/game/engine';
import { toColors } from '../src/game/types';
import type { GameState } from '../src/game/types';

interface RustBakedLevel {
  level: number;
  bottles: string[][];
  capacity: number;
  hidden: boolean[][];
  funnels: (string | null)[];
  ice: (string | null)[][];
  optimal: number;
  twoStarMax: number;
  par: number;
  phase: string;
  mechanics: string[];
}

interface GoldenLine {
  level: number;
  line: [number, number][] | null;
}

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npx tsx scripts/verify-bake.ts <bake-out-dir>');
  process.exit(2);
}

const levels = JSON.parse(readFileSync(join(dir, 'levels.json'), 'utf8')) as RustBakedLevel[];
const golden = new Map(
  (JSON.parse(readFileSync(join(dir, 'golden-lines.json'), 'utf8')) as GoldenLine[]).map((g) => [
    g.level,
    g.line,
  ]),
);

const fail = (level: number, msg: string): never => {
  console.error(`FAIL L${level}: ${msg}`);
  process.exit(1);
};

let replayed = 0;
let skipped = 0;

for (const b of levels) {
  const state: GameState = { bottles: b.bottles.map(toColors), capacity: b.capacity };
  // Deserialize through the registry — the exact path the app loads baked levels with.
  let set: OverlaySet = deserializeOverlays({ hidden: b.hidden, funnels: b.funnels, ice: b.ice });

  // --- G4: static checks ---
  if (state.bottles.some((col) => col.length > b.capacity)) fail(b.level, 'overfull tube');
  if (isWon(state)) fail(b.level, 'board already won');
  if (state.bottles.some((col) => col.length > 0 && isComplete(col, b.capacity)))
    fail(b.level, 'degenerate: pre-completed tube');
  if (b.par < 1) fail(b.level, `par ${b.par} < 1`);
  if (b.twoStarMax <= b.optimal) fail(b.level, `twoStarMax ${b.twoStarMax} <= optimal ${b.optimal}`);
  if (b.mechanics.includes('funnel') && !anyFunnel(set.funnels))
    fail(b.level, 'funnel chapter level shows no funnel');
  if (b.mechanics.includes('ice') && !anyIce(set.ice)) fail(b.level, 'ice chapter level shows no ice');

  // --- G3: golden-line replay under JS player rules ---
  const line = golden.get(b.level);
  if (line == null) {
    skipped++; // proxy-optimal level (Rust A* overflowed) — nothing to replay
    continue;
  }
  let cur = state;
  let pours = 0;
  for (const [from, to] of line) {
    const blocked = blockedColumns(set, cur);
    const src = cur.bottles[from];
    if (!src || src.length === 0) fail(b.level, `pour ${pours}: empty source ${from}`);
    if (isCapped(src!, cur.capacity, blocked[from])) fail(b.level, `pour ${pours}: source ${from} capped`);
    const cap = knownTopRun(src!, blocked[from]);
    if (cap <= 0) fail(b.level, `pour ${pours}: source ${from} top blocked`);
    if (!canPour(cur, from, to)) fail(b.level, `pour ${pours}: illegal ${from}->${to}`);
    if (!funnelAccepts(set.funnels, to, topColor(src!)!))
      fail(b.level, `pour ${pours}: funnel rejects ${from}->${to}`);
    cur = pour(cur, from, to, cap).state;
    set = { ...set, hidden: revealExposed(cur, set.hidden) };
    pours++;
  }
  if (!isWon(cur)) fail(b.level, 'golden line does not win');
  if (anyHidden(set.hidden)) fail(b.level, 'golden line leaves concealed cells');
  if (anyFrozen(cur, set.hidden, set.ice)) fail(b.level, 'golden line leaves frozen cells');
  if (pours !== b.optimal) fail(b.level, `golden line wins in ${pours}, optimal says ${b.optimal}`);
  replayed++;
}

console.log(
  `PASS: ${levels.length} levels — static checks all green; ${replayed} golden lines replayed at exact optimal (${skipped} proxy levels skipped)`,
);
