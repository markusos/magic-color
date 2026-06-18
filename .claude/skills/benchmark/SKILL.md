---
name: benchmark
description: Benchmark level generation for magic-color — measure how fast generateForLevel produces boards and check it stays instant on mobile. Use when asked to benchmark, profile, or time level generation, check generation/load performance, or verify a generator/progression/solver change didn't regress speed.
---

# Benchmarking level generation

Level boards are generated on demand on the **main thread** when a level loads, so generation
(plus the per-level star-reference computation) must feel instant — especially on a phone. This
skill times that path across many levels and flags anything that would hitch on an iPhone.

The script lives at [scripts/benchmark-generation.ts](../../../scripts/benchmark-generation.ts).

## Run it

```bash
npm run bench           # first 1000 levels (default)
npm run bench -- 5000   # first 5000 levels
npm run bench -- 200    # quick pass while iterating
```

Or directly: `npx tsx scripts/benchmark-generation.ts [count]`.

It times `generateForLevel(level)` for `level = 1..count` (after a JIT warm-up) and prints:

- **Per-level distribution** on this machine: mean, median, p95, p99, max.
- **Estimated iPhone time**: the same percentiles times a deliberately pessimistic `×3`
  single-thread slowdown. Treat it as a rough upper bound, not a measurement — modern A-series
  chips are closer to ~1.5–2× a Mac.
- **Budget check**: how many levels exceed the 100 ms "instant" load budget on the iPhone estimate.
  This should be **0**.
- **Slowest 15 levels**, with each one's phase / tube count / color count so you can see *which*
  footprint is expensive.

## How to read the results

- **Median tells you the common case; the max and p99 tell you the risk.** Generation is
  rejection-sampled, and the star reference runs a solver, so timing has a long tail — judge by the
  tail, not the average.
- **Look at the phase/footprint of the slowest levels.** If the slow ones cluster on one footprint
  (e.g. "10 tubes"), the cost is tied to that board size, not to generation in general.
- **Separate generation from the star reference.** The generator itself is sub-millisecond even for
  15-tube boards. Historically the slow tail came from the exact-optimal A* (`optimalCappedMoves`)
  that `optimalFor` runs at load time for small boards — it explodes on concealed (hidden-mechanic)
  10-tube boards. If the tail is back, suspect that A*, not `generateLevel`. The relevant knob is
  `EXACT_OPTIMAL_MAX_BOTTLES` in [src/game/progression.ts](../../../src/game/progression.ts): boards
  larger than it use a fast solution-replay upper bound instead of exact A*.
- **A tighter solver node budget usually won't fix a hidden-board tail** — the cost there is
  per-node work (concealment state + reveal logic), not node count.

## When to run it

- After changing the generator ([generator.ts](../../../src/game/generator.ts)), the solver/search
  ([solver.ts](../../../src/game/solver.ts), [search.ts](../../../src/game/search.ts)), the hidden
  mechanic ([hidden.ts](../../../src/game/hidden.ts)), or the progression/par tuning
  ([progression.ts](../../../src/game/progression.ts)).
- Whenever the difficulty curve changes which footprints appear, and how often. Levels past the
  last chapter plateau on the hardest footprint, so a 1000-level run is mostly stress-testing the
  top of the ladder.

## What "fast enough" means

The 100 ms budget is the classic "instant" threshold for a load/transition. Target **0 levels over
budget** on the (pessimistic) iPhone estimate. If a footprint blows the budget, prefer the cheap
upper-bound path for it over exact computation, rather than trying to micro-optimize the solver.
