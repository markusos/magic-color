/**
 * Level-generation benchmark. Times `generateForLevel` for the first N levels (default 1000) and
 * reports the timing distribution plus the slowest levels, so we can sanity-check that generation
 * feels instant on a phone (it runs on the main thread when a level loads).
 *
 * Run: `npm run bench [-- count]` (or `npx tsx scripts/benchmark-generation.ts [count]`).
 * See .claude/skills/benchmark for how to read the output and when to run it.
 *
 * The iPhone estimate applies a conservative single-thread slowdown vs. this dev machine. Treat it
 * as a rough upper bound, not a measurement — real numbers depend on the device and JS engine.
 */
import { generateForLevel, planForLevel } from '../src/game/progression';

const COUNT = Number(process.argv[2] ?? 1000);
// Modern A-series iPhones are within ~1.5–2x of an M-series Mac on single-threaded JS; older
// phones are slower. Use a deliberately pessimistic factor so "fast" here means "fast there".
const IPHONE_SLOWDOWN = 3;
// Budget for a load to still feel instant. 100ms is the classic "instant" threshold.
const INSTANT_MS = 100;

interface Sample {
  level: number;
  ms: number;
  phase: string;
  bottles: number;
  colors: number;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

function main(): void {
  // Warm up the JIT so the first few timings aren't cold outliers.
  for (let i = 0; i < 20; i++) generateForLevel(1 + (i % 5));

  const samples: Sample[] = [];
  const wallStart = performance.now();
  for (let level = 1; level <= COUNT; level++) {
    const plan = planForLevel(level);
    const t0 = performance.now();
    generateForLevel(level);
    const ms = performance.now() - t0;
    samples.push({ level, ms, phase: plan.phase, bottles: plan.bottles, colors: plan.colors });
  }
  const wallMs = performance.now() - wallStart;

  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const total = times.reduce((a, b) => a + b, 0);
  const mean = total / times.length;
  const slowest = [...samples].sort((a, b) => b.ms - a.ms).slice(0, 15);

  const fmt = (n: number) => n.toFixed(2).padStart(8);
  console.log(`\nGenerated ${COUNT} levels in ${wallMs.toFixed(0)}ms wall time.\n`);
  console.log('Per-level generation time (this machine):');
  console.log(`  mean   ${fmt(mean)} ms`);
  console.log(`  median ${fmt(pct(times, 50))} ms`);
  console.log(`  p95    ${fmt(pct(times, 95))} ms`);
  console.log(`  p99    ${fmt(pct(times, 99))} ms`);
  console.log(`  max    ${fmt(times[times.length - 1]!)} ms`);

  console.log(`\nEstimated iPhone time (x${IPHONE_SLOWDOWN}, pessimistic):`);
  console.log(`  median ${fmt(pct(times, 50) * IPHONE_SLOWDOWN)} ms`);
  console.log(`  p95    ${fmt(pct(times, 95) * IPHONE_SLOWDOWN)} ms`);
  console.log(`  p99    ${fmt(pct(times, 99) * IPHONE_SLOWDOWN)} ms`);
  console.log(`  max    ${fmt(times[times.length - 1]! * IPHONE_SLOWDOWN)} ms`);

  const overBudget = samples.filter((s) => s.ms * IPHONE_SLOWDOWN > INSTANT_MS);
  console.log(
    `\nLevels whose estimated iPhone time exceeds the ${INSTANT_MS}ms "instant" budget: ${overBudget.length} / ${COUNT}`,
  );

  console.log('\nSlowest 15 levels (this machine):');
  for (const s of slowest) {
    console.log(
      `  L${String(s.level).padStart(4)}  ${fmt(s.ms)} ms  (${s.phase}, ${s.bottles} tubes, ${s.colors} colors)`,
    );
  }
  console.log('');
}

main();
