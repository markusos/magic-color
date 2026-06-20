/**
 * Offline level bake (v2 — difficulty-first). For each chapter we generate a large candidate pool
 * spanning ALL board shapes (small / tall / medium / large), measure each candidate precisely
 * (exact optimal, forced-move ratio, dead-end density — see difficulty.ts), score it on a
 * size-normalized scale, and assign boards to the chapter's curve slots with shape variety. Board
 * SIZE therefore varies within every difficulty band; difficulty comes from the score, not the tube
 * count. The result is committed as static data (`src/game/levels.data.ts`) the app loads instead of
 * generating on device, plus a debug-only provenance sidecar (`scripts/levels.provenance.json`).
 *
 * Run: `npm run build:levels [-- count perShape nodeBudget deadEndSamples]`
 *   count          how many levels to bake (default 60 = chapters 0 + 1)
 *   perShape       candidates sampled per shape per chapter (default 80; raise for higher quality)
 *   nodeBudget     exact-optimal A* node budget per candidate (default 150k)
 *   deadEndSamples random playouts per candidate for the dead-end estimate (default 24)
 *
 * Quality over bake time is the explicit tradeoff (PLAN.md) — generous sampling is fine; this is a
 * manual, offline step whose output is reviewed and committed.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BakedLevel } from '../src/game/baked';
import { assignSlots, compositeScores, measureMetrics, type Metrics } from '../src/game/difficulty';
import { generateCandidates } from '../src/game/generator';
import { computeHidden, emptyGrid, exposableCells, type HiddenGrid } from '../src/game/hidden';
import {
  CHAPTER_LEN,
  mechanicsForLevel,
  phaseForLevel,
  seedForLevel,
  SHAPES,
  targetPercentile,
} from '../src/game/progression';
import type { GameState, Mechanic, Move } from '../src/game/types';
import { currentGeneratorVersion } from './levelVersion';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const COUNT = Number(process.argv[2] ?? 60);
const PER_SHAPE = Number(process.argv[3] ?? 80);
const NODE_BUDGET = Number(process.argv[4] ?? 150_000);
const DEAD_END_SAMPLES = Number(process.argv[5] ?? 24);

interface Candidate {
  state: GameState;
  solution: Move[];
  hidden: HiddenGrid;
  metrics: Metrics;
  family: string;
  bottles: number;
  capacity: number;
  par: number;
}

interface Provenance {
  level: number;
  chapter: number;
  phase: string;
  family: string;
  footprint: string;
  targetPercentile: number;
  score: number;
  metrics: Metrics;
}

/** Build the scored candidate pool for one chapter, across every shape. */
function poolForChapter(chapter: number, mechanics: readonly Mechanic[]): Candidate[] {
  const isHidden = mechanics.includes('hidden');
  const pool: Candidate[] = [];

  SHAPES.forEach((shape, si) => {
    const seed = seedForLevel(50_000 + chapter * 100 + si);
    const candidates = generateCandidates(
      { colors: shape.colors, bottles: shape.bottles, capacity: shape.capacity, seed },
      PER_SHAPE,
    );
    candidates.forEach((c, ci) => {
      const tag = chapter * 1_000_000 + si * 10_000 + ci;
      const hidden = isHidden
        ? computeHidden(c.state, seedForLevel(tag), exposableCells(c.state, c.solution))
        : emptyGrid(c.state);
      const metrics = measureMetrics(c.state, hidden, c.solution, {
        optimalNodeBudget: NODE_BUDGET,
        deadEndSamples: DEAD_END_SAMPLES,
        deadEndSeed: tag,
      });
      pool.push({
        state: c.state,
        solution: c.solution,
        hidden,
        metrics,
        family: shape.family,
        bottles: shape.bottles,
        capacity: shape.capacity,
        par: c.par,
      });
    });
  });
  return pool;
}

function main(): void {
  const baked: BakedLevel[] = [];
  const provenance: Provenance[] = [];
  const wallStart = performance.now();

  for (let chapter = 0; chapter * CHAPTER_LEN < COUNT; chapter++) {
    const firstLevel = chapter * CHAPTER_LEN + 1;
    const lastLevel = Math.min((chapter + 1) * CHAPTER_LEN, COUNT);
    const levels = Array.from({ length: lastLevel - firstLevel + 1 }, (_, i) => firstLevel + i);
    const mechanics = mechanicsForLevel(firstLevel);

    console.log(`\nChapter ${chapter} (levels ${firstLevel}–${lastLevel}, mechanics [${mechanics.join(',')}])`);
    const pool = poolForChapter(chapter, mechanics);
    const scores = compositeScores(pool.map((c) => c.metrics));
    const targets = levels.map((l) => targetPercentile(l));
    const slotIdx = assignSlots(
      pool.map((c, i) => ({ score: scores[i]!, family: c.family })),
      targets,
    );

    levels.forEach((level, s) => {
      const chosen = pool[slotIdx[s]!]!;
      const score = scores[slotIdx[s]!]!;
      baked.push({
        level,
        bottles: chosen.state.bottles.map((col) => [...col]),
        capacity: chosen.capacity,
        hidden: chosen.hidden.map((col) => [...col]),
        optimal: chosen.metrics.optimal,
        par: chosen.par,
        phase: phaseForLevel(level),
        mechanics: [...mechanics],
      });
      provenance.push({
        level,
        chapter,
        phase: phaseForLevel(level),
        family: chosen.family,
        footprint: `${chosen.metrics.colors}c/${chosen.bottles}b×${chosen.capacity}`,
        targetPercentile: Number(targets[s]!.toFixed(3)),
        score: Number(score.toFixed(3)),
        metrics: chosen.metrics,
      });

      const m = chosen.metrics;
      console.log(
        `  L${String(level).padStart(2)} ${phaseForLevel(level).padEnd(6)} ${chosen.family.padEnd(6)}` +
          ` ${`${m.colors}c/${chosen.bottles}b×${chosen.capacity}`.padEnd(10)}` +
          ` score=${score.toFixed(2)} opt=${String(m.optimal).padStart(3)}${m.optimalExact ? ' ' : '~'}` +
          ` dead=${m.deadEndDensity.toFixed(2)} forced=${m.forcedMoveRatio.toFixed(2)} dig=${m.digDepth.toFixed(2)} tgt=${targets[s]!.toFixed(2)}`,
      );
    });
  }

  const version = currentGeneratorVersion();
  writeFileSync(
    join(ROOT, 'src/game/levels.data.ts'),
    `/* eslint-disable */\n` +
      `// AUTO-GENERATED by scripts/build-levels.ts — do not edit by hand. Run \`npm run build:levels\`.\n` +
      `import type { BakedLevel } from './baked';\n\n` +
      `export const GENERATOR_VERSION = ${JSON.stringify(version)};\n\n` +
      `export const BAKED_LEVELS = ${JSON.stringify(baked)} as readonly BakedLevel[];\n`,
  );
  writeFileSync(
    join(ROOT, 'scripts/levels.provenance.json'),
    JSON.stringify(
      { version, count: baked.length, perShape: PER_SHAPE, levels: provenance },
      null,
      2,
    ) + '\n',
  );

  const wallMs = performance.now() - wallStart;
  console.log(
    `\nBaked ${baked.length} levels in ${(wallMs / 1000).toFixed(1)}s → src/game/levels.data.ts (version ${version})`,
  );
}

main();
