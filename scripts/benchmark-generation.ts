/**
 * Level-load benchmark. Times `getLevel` for the first N levels (default 1000) and reports the
 * timing distribution plus the slowest levels, so we can sanity-check that loading feels instant on
 * a phone (it runs on the main thread when a level loads). Baked levels (1..N) deserialize instantly;
 * the plateau tail generates live, so the slowest samples come from there.
 *
 * Run: `npm run bench [-- count]` (or `npx tsx scripts/benchmark-generation.ts [count]`).
 * See .claude/skills/benchmark for how to read the output and when to run it.
 *
 * The iPhone estimate applies a conservative single-thread slowdown vs. this dev machine. Treat it
 * as a rough upper bound, not a measurement — real numbers depend on the device and JS engine.
 */
import { getLevel } from '../src/game/levelLoader';

const COUNT = Number(process.argv[2] ?? 1000);
// Modern A-series iPhones are within ~1.5–2x of an M-series Mac on single-threaded JS; older
// phones are slower. Use a deliberately pessimistic factor so "fast" here means "fast there".
const IPHONE_SLOWDOWN = 3;
// Load budget. Instant is no longer required: live (un-baked) levels generate a higher-quality board
// behind a spinner, so we allow up to ~2s. Baked levels still load effectively instantly.
const BUDGET_MS = 2000;

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
  for (let i = 0; i < 20; i++) getLevel(1 + (i % 5));

  const samples: Sample[] = [];
  const wallStart = performance.now();
  for (let level = 1; level <= COUNT; level++) {
    // Measure the real load path: baked levels deserialize instantly, the tail generates live.
    const t0 = performance.now();
    const lvl = getLevel(level);
    const ms = performance.now() - t0;
    samples.push({ level, ms, phase: lvl.phase, bottles: lvl.bottles, colors: lvl.colors });
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

  const overBudget = samples.filter((s) => s.ms * IPHONE_SLOWDOWN > BUDGET_MS);
  console.log(
    `\nLevels whose estimated iPhone time exceeds the ${BUDGET_MS}ms budget: ${overBudget.length} / ${COUNT}`,
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
