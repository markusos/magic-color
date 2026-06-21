# Plan: what's left

The two big efforts that built this file's progression system are **done** and no longer tracked
here:

- **Pre-baked curated levels (v2, difficulty-first)** — offline bake, size-normalized scoring, live
  budget + spinner, endless mode. BUILT.
- **Chapter 2 — color-locked funnels** — parallel overlay, solvability-by-construction, `funnelLoad`
  scoring. BUILT (UI "Chapter 3"; 180 levels baked).

Their full design rationale and as-built notes live in the `baked-levels-plan` and `funnels-mechanic`
memory notes, the README "Architecture" section, and git history (see commits up to and including the
funnels work). This file now only carries the open work.

---

## Open work (tuning by feel + growth, not gaps)

- **Re-tune the curve.** Adjust `SCORE_WEIGHTS` / `CURVE` in `difficulty.ts` + `progression.ts` from
  real playtests, then re-bake. This is iterative and never "done."
- **Settle the funnel knobs.** The `funnelLoad` formula (locked-count/colors vs. branching-reduction)
  and the per-board lock cap were left to settle by feel — revisit alongside playtest re-bakes.
- **New mechanic chapters.** Extend `MECHANIC_SETS` (cumulative), bump the campaign length, author +
  bake the chapter. The endless "Play Random Hard" mode picks up new mechanics automatically (it
  unions all `MECHANIC_SETS`). Mirror the `hidden`/`funnel` blueprint: a parallel overlay enforced at
  the store + offline solver, derived from the stored solution for free solvability — never an engine
  change.

## Re-baking

`npm run build:levels` (≈8 min for the full campaign, deterministic). Any change to a bake-relevant
source bumps the `levelVersion.ts` hash; `baked.test.ts` then fails until you re-bake. Re-baking
reproduces earlier chapters byte-identically (seed-deterministic).
