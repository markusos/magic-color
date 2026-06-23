/**
 * Offline level bake (v2 — difficulty-first). For each chapter we generate a large candidate pool
 * spanning ALL board shapes (small / tall / medium / large), measure each candidate precisely
 * (exact optimal, forced-move ratio, dead-end density — see difficulty.ts), score it on a
 * size-normalized scale, and assign boards to the chapter's curve slots with shape variety. Board
 * SIZE therefore varies within every difficulty band; difficulty comes from the score, not the tube
 * count. The result is committed as static data (`src/game/levels.data.ts`) the app loads instead of
 * generating on device, plus a debug-only provenance sidecar (`scripts/levels.provenance.json`).
 *
 * Run: `npm run build:levels [-- count perShape nodeBudget deadEndSamples concurrency]`
 *   count          how many levels to bake (default = every defined chapter at full length)
 *   perShape       candidates sampled per shape per chapter (default 80; raise for higher quality)
 *   nodeBudget     exact-optimal A* node budget per candidate (default 150k)
 *   deadEndSamples random playouts per candidate for the dead-end estimate (default 24)
 *   concurrency    worker threads to run in parallel (default: CPU count − 1)
 *
 * Quality over bake time is the explicit tradeoff (PLAN.md) — generous sampling is fine; this is a
 * manual, offline step whose output is reviewed and committed.
 *
 * The heavy work (generate + measure each candidate) is split into independent (chapter, shape)
 * jobs run across a worker pool (build-levels.worker.ts). Results are reassembled in canonical
 * (chapter, shape, candidate) order before scoring, so the committed output is byte-identical to a
 * serial bake — parallelism only shortens wall time. The long pole is the most expensive single
 * shape (the deepest tall board), so speedup is sub-linear in core count.
 */
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { BakedLevel } from '../src/game/baked';
import { assignSlots, compositeScores, type Metrics } from '../src/game/difficulty';
import { filterPresence, serializeOverlays } from '../src/game/mechanics';
import {
  CAMPAIGN_LENGTH,
  campaignDensity,
  CHAPTER_LEN,
  mechanicsForLevel,
  phaseForLevel,
  SHAPES,
  targetPercentile,
} from '../src/game/progression';
import { currentGeneratorVersion } from './levelVersion';
import type { Candidate, ShapeJob } from './build-levels.worker';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'scripts/build-levels.worker.ts');

const COUNT = Number(process.argv[2] ?? CAMPAIGN_LENGTH);
const PER_SHAPE = Number(process.argv[3] ?? 80);
const NODE_BUDGET = Number(process.argv[4] ?? 150_000);
const DEAD_END_SAMPLES = Number(process.argv[5] ?? 24);
const CONCURRENCY = Number(process.argv[6] ?? Math.max(1, cpus().length - 1));

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

/**
 * Run all jobs across a pool of `concurrency` workers, returning each job's candidates indexed by
 * job order. Workers are reused (dispatched the next job as each result lands) to amortize the
 * per-worker tsx/module startup cost.
 */
function runJobs(jobs: ShapeJob[], concurrency: number): Promise<Candidate[][]> {
  const results: Candidate[][] = new Array<Candidate[]>(jobs.length);
  const poolSize = Math.min(jobs.length, Math.max(1, concurrency));
  let next = 0;
  let done = 0;

  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const finish = (err?: Error) => {
      workers.forEach((w) => void w.terminate());
      if (err) reject(err);
      else resolve(results);
    };
    const dispatch = (w: Worker) => {
      if (next >= jobs.length) return;
      const id = next++;
      w.postMessage({ ...jobs[id]!, id });
    };

    for (let i = 0; i < poolSize; i++) {
      // Inherit the parent's execArgv so the tsx loader carries into the worker and it can run the
      // .ts worker file directly (no separate compile step).
      const worker = new Worker(WORKER, { execArgv: process.execArgv });
      worker.on('message', (msg: { id: number; candidates: Candidate[] }) => {
        results[msg.id] = msg.candidates;
        if (++done === jobs.length) finish();
        else dispatch(worker);
      });
      worker.on('error', finish);
      workers.push(worker);
      dispatch(worker);
    }
  });
}

async function main(): Promise<void> {
  const baked: BakedLevel[] = [];
  const provenance: Provenance[] = [];
  const wallStart = performance.now();

  const chapters: number[] = [];
  for (let chapter = 0; chapter * CHAPTER_LEN < COUNT; chapter++) chapters.push(chapter);

  // One job per (chapter, shape), flattened across chapters so cheap shapes from one chapter can
  // fill cores while another chapter's deep tall board is still running.
  const jobs: ShapeJob[] = [];
  for (const chapter of chapters) {
    const chapterMechanics = mechanicsForLevel(chapter * CHAPTER_LEN + 1);
    // Spotlight this chapter's signature mechanic (dialed up) over inherited ones (seasoned in light).
    const density = campaignDensity(chapter);
    SHAPES.forEach((_, si) => {
      jobs.push({
        chapter,
        si,
        mechanics: [...chapterMechanics],
        density,
        perShape: PER_SHAPE,
        nodeBudget: NODE_BUDGET,
        deadEndSamples: DEAD_END_SAMPLES,
      });
    });
  }

  console.log(
    `Baking ${COUNT} levels: ${jobs.length} shape-pools (${SHAPES.length} shapes × ${chapters.length} chapters)` +
      ` across ${Math.min(jobs.length, CONCURRENCY)} workers…`,
  );
  const jobResults = await runJobs(jobs, CONCURRENCY);

  for (const chapter of chapters) {
    const firstLevel = chapter * CHAPTER_LEN + 1;
    const lastLevel = Math.min((chapter + 1) * CHAPTER_LEN, COUNT);
    const levels = Array.from({ length: lastLevel - firstLevel + 1 }, (_, i) => firstLevel + i);
    const mechanics = mechanicsForLevel(firstLevel);

    // Reassemble the chapter's pool in (shape index, candidate index) order — identical to serial.
    const assembled: Candidate[] = [];
    jobs.forEach((job, ji) => {
      if (job.chapter === chapter) assembled.push(...jobResults[ji]!);
    });

    // A chapter must SHOW each of its `requiresPresence` mechanics (funnels, ice) on every level, so
    // drop candidates that ended up without one — they can never be assigned to a slot. Driven off the
    // registry, so a future "must show" mechanic is covered automatically (see `filterPresence`).
    const pool = filterPresence(assembled, mechanics);

    console.log(`\nChapter ${chapter} (levels ${firstLevel}–${lastLevel}, mechanics [${mechanics.join(',')}])`);
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
        ...serializeOverlays(chosen), // hidden, funnels, ice — same key order as before
        optimal: chosen.metrics.optimal,
        twoStarMax: chosen.metrics.twoStarMax,
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
          ` 2★≤${String(m.twoStarMax).padStart(3)}` +
          ` dead=${m.deadEndDensity.toFixed(2)} forced=${m.forcedMoveRatio.toFixed(2)} dig=${m.digDepth.toFixed(2)} fun=${m.funnelLoad.toFixed(2)} ice=${m.iceLoad.toFixed(2)} tgt=${targets[s]!.toFixed(2)}`,
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
