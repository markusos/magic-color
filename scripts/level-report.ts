/**
 * Bake report / diff CLI (Track E2). Reads the committed bake provenance sidecar(s) and either
 * summarizes one bake or diffs two. All analysis lives in the typed, unit-tested
 * `src/game/levelReport.ts`; this file is just argument parsing, file IO, and formatting.
 *
 *   npm run levels:report                    # report on scripts/levels.provenance.json
 *   npm run levels:report -- some.json       # report on a specific file
 *   npm run levels:report -- old.json new.json   # diff two bakes (which levels moved, by how much)
 *
 * Tuning loop: copy scripts/levels.provenance.json aside, change SCORE_WEIGHTS/SHAPES, re-bake, then
 * `npm run levels:report -- old.json scripts/levels.provenance.json` for a precise per-level delta.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LevelProvenance } from '../src/game/provenance';
import {
  buildReport,
  diffProvenance,
  histogram,
  REPORT_METRICS,
  type ChapterReport,
} from '../src/game/levelReport';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PATH = join(ROOT, 'scripts/levels.provenance.json');

interface ProvenanceFile {
  version?: string;
  count?: number;
  levels: LevelProvenance[];
}

function load(path: string): ProvenanceFile {
  const abs = resolve(process.cwd(), path);
  return JSON.parse(readFileSync(abs, 'utf8')) as ProvenanceFile;
}

const f2 = (n: number): string => n.toFixed(2);
const signed = (n: number, dp: number): string => (n >= 0 ? '+' : '') + n.toFixed(dp);
const padL = (s: string | number, n: number): string => String(s).padStart(n);
const padR = (s: string | number, n: number): string => String(s).padEnd(n);

/** A scaled `#` bar for a histogram bucket. */
function bar(count: number, max: number, width = 36): string {
  const n = max > 0 ? Math.round((count / max) * width) : 0;
  return '#'.repeat(n);
}

function printReport(path: string, file: ProvenanceFile): void {
  const levels = file.levels;
  console.log(`Bake report: ${path}  (version ${file.version ?? '?'}, ${levels.length} levels)\n`);

  // Overall score distribution across the whole campaign.
  const scores = levels.map((l) => l.score);
  const buckets = histogram(scores, 10, 0, 1);
  const max = Math.max(...buckets);
  console.log('Score distribution (0.0–1.0):');
  buckets.forEach((c, i) => {
    console.log(`  ${(i / 10).toFixed(1)} ${padR(bar(c, max), 36)} ${c}`);
  });
  console.log();

  for (const ch of buildReport(levels)) printChapter(ch);
}

function printChapter(ch: ChapterReport): void {
  const fam = Object.entries(ch.families)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  const metrics = REPORT_METRICS.map(
    (k) => `${k.replace(/(Density|Ratio|Load)$/, '')} ${f2(ch.metricMeans[k])}`,
  ).join('  ');

  console.log(`Chapter ${ch.chapter}  levels ${ch.firstLevel}–${ch.lastLevel}  (${ch.count})`);
  console.log(
    `  score   min ${f2(ch.score.min)}  mean ${f2(ch.score.mean)}  median ${f2(ch.score.median)}  max ${f2(ch.score.max)}`,
  );
  console.log(
    `  optimal min ${padL(ch.optimal.min, 3)}  mean ${ch.optimal.mean.toFixed(1)}  max ${padL(ch.optimal.max, 3)}   exact ${Math.round(ch.exactRate * 100)}%`,
  );
  console.log(`  family  ${fam}`);
  console.log(`  metrics ${metrics}`);
  if (ch.monotonicity.length === 0) {
    console.log('  monotonicity: ok');
  } else {
    // 3 decimals here: the slips are real but often sub-0.01, so 2dp can misleadingly read as equal.
    const slips = ch.monotonicity
      .map((v) => `L${v.level}(${v.score.toFixed(3)}<${v.prevScore.toFixed(3)})`)
      .join(', ');
    console.log(`  monotonicity: ${ch.monotonicity.length} slip(s): ${slips}`);
  }
  console.log();
}

const TOP_CHANGES = 40;

function printDiff(aPath: string, bPath: string, a: ProvenanceFile, b: ProvenanceFile): void {
  const diff = diffProvenance(a.levels, b.levels);
  console.log(`Diff: ${aPath}  →  ${bPath}`);
  console.log(`  baseline ${a.version ?? '?'} → new ${b.version ?? '?'}\n`);
  console.log(`  added:     ${diff.added.length ? diff.added.join(', ') : 'none'}`);
  console.log(`  removed:   ${diff.removed.length ? diff.removed.join(', ') : 'none'}`);
  console.log(`  changed:   ${diff.changed.length} level(s)  (${diff.unchanged} unchanged)\n`);

  if (diff.changed.length === 0) return;

  console.log(`  ${padR('level', 7)}${padR('Δscore', 9)}${padR('score', 14)}${padR('Δopt', 7)}family`);
  for (const d of diff.changed.slice(0, TOP_CHANGES)) {
    const family = d.familyA === d.familyB ? d.familyA : `${d.familyA}→${d.familyB}`;
    console.log(
      `  ${padR('L' + d.level, 7)}${padR(signed(d.dScore, 2), 9)}${padR(`${f2(d.scoreA)}→${f2(d.scoreB)}`, 14)}${padR(signed(d.dOptimal, 0), 7)}${family}`,
    );
  }
  if (diff.changed.length > TOP_CHANGES) {
    console.log(`  … ${diff.changed.length - TOP_CHANGES} more (sorted by |Δscore|)`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length >= 2) {
    printDiff(args[0]!, args[1]!, load(args[0]!), load(args[1]!));
  } else {
    const path = args[0] ?? DEFAULT_PATH;
    printReport(path, load(path));
  }
}

main();
