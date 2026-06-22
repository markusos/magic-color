---
name: benchmark
description: Benchmark level loading for magic-color — time getLevel across the campaign so baked levels stay instant and the live-generated tail/endless boards stay within the loading-spinner budget. Use when asked to benchmark, profile, or time level loading/generation, or to verify a generator/solver/load-path change didn't regress speed.
---

# Benchmarking level loading

A level's board is produced on the **main thread** when the level loads. Two paths exist:

- **Baked levels** (1..`BAKED_LEVEL_COUNT`, currently 180) deserialize from `levels.data.ts` — effectively
  instant.
- **Live levels** generate on device: the **plateau tail** (levels past the baked range) and the
  endless **"Play Random"** mode. These run a best-of-N generator plus a star-reference solver, so they
  take up to ~1–2s — covered by a loading spinner, *not* required to be instant.

This skill times the real `getLevel` path across many levels so we can confirm baked levels stay
instant and the live tail stays within the spinner budget.

The script lives at [scripts/benchmark-generation.ts](../../../scripts/benchmark-generation.ts).

## Run it

```bash
npm run bench           # first 1000 levels (default)
npm run bench -- 5000   # first 5000 levels
npm run bench -- 200    # quick pass while iterating
```

Or directly: `npx tsx scripts/benchmark-generation.ts [count]`.

It times `getLevel(level)` for `level = 1..count` (after a JIT warm-up) and prints:

- **Per-level distribution** on this machine: mean, median, p95, p99, max.
- **Estimated iPhone time**: the same percentiles times a deliberately pessimistic `×3` single-thread
  slowdown. Treat it as a rough upper bound, not a measurement — modern A-series chips are closer to
  ~1.5–2× a Mac.
- **Budget check**: how many levels exceed the **2000 ms** spinner budget on the iPhone estimate.
- **Slowest 15 levels**, with each one's phase / tube count / color count so you can see *which*
  footprint is expensive.

## How to read the results

- **Baked vs live.** Levels within the baked range deserialize in ~0 ms, so the median over a
  1000-level run is dominated by the live tail. The over-budget count is *expected to be non-zero* —
  it's the hardest live footprints (tall capacity-10, large 15-tube), not a failure. Watch for the
  count or the tail **growing** after a change, not for it being zero.
- **Median tells you the common case; the max and p99 tell you the risk.** Live generation is
  rejection-sampled and the star reference runs a solver, so timing has a long tail — judge by the
  tail, not the average.
- **Look at the phase/footprint of the slowest levels.** If the slow ones cluster on one footprint
  (e.g. "10 tubes"), the cost is tied to that board size, not to generation in general.
- **Separate generation from the star reference.** The generator itself is sub-millisecond even for
  15-tube boards. The slow tail comes from the exact-optimal A* (`optimalCappedMoves`) that
  `optimalFor` runs at load time for small boards — it explodes on concealed (hidden-mechanic) 10-tube
  boards. If the tail regresses, suspect that A*, not `generateLevel`. The relevant knob is
  `EXACT_OPTIMAL_MAX_BOTTLES` in [src/game/levelLoader.ts](../../../src/game/levelLoader.ts): boards
  larger than it use a fast solution-replay upper bound instead of exact A*.
- **A tighter solver node budget usually won't fix a hidden-board tail** — the cost there is per-node
  work (concealment state + reveal logic), not node count.

## When to run it

- After changing the live load path ([levelLoader.ts](../../../src/game/levelLoader.ts)), the generator
  ([generator.ts](../../../src/game/generator.ts)), the solver/search
  ([solver.ts](../../../src/game/solver.ts), [search.ts](../../../src/game/search.ts)), the hidden
  mechanic ([hidden.ts](../../../src/game/hidden.ts)), or the progression/par tuning
  ([progression.ts](../../../src/game/progression.ts)).
- Whenever the difficulty curve or shape menu changes which footprints appear on the live tail. Levels
  past the last chapter plateau on the hardest footprints, so a 1000-level run is mostly stress-testing
  the top of the ladder.
- Note: baked levels don't change unless you re-bake (`npm run build:levels`), so a load-path-only
  change moves the live-tail numbers, not the baked ones.

## What "fast enough" means

Baked levels should stay effectively instant (~0 ms). Live levels (tail + endless) should stay within
the **2000 ms** spinner budget on the pessimistic iPhone estimate; an occasional hard footprint near
the top is acceptable since the spinner covers it. If a footprint consistently blows the budget, prefer
the cheap upper-bound path for it (raise the bar via `EXACT_OPTIMAL_MAX_BOTTLES`) over micro-optimizing
the solver — or bake more of the tail.
