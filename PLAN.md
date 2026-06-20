# Plan: Pre-baked levels for a curated, higher-quality progression

## Goal

Move level generation **off the player's device and into an offline build script**, so we can
spend far more compute per level than a phone can afford at load time. The script picks the best
board for each slot against an intentional difficulty curve, and the result is committed as static
data that the app simply loads.

**First milestone:** bake the first **60 levels** — the two authored chapters:

- **30 base levels** (chapter 0, no mechanics) — levels 1–30
- **30 hidden-state levels** (chapter 1, `hidden` mechanic) — levels 31–60

Levels past 60 keep using the existing live generator (the "plateau" tail), so play stays endless.

---

## Status & remaining gaps (updated 2026-06-20)

**COMPLETE and green** (lint + typecheck + 151 tests pass). Every planned item — the v2 difficulty-first
bake, the full metric set, the live budget + spinner, the endless mode, and all polish — is built. No
remaining gaps; what's left below the line is future *tuning by feel* (re-weight from real playtests)
and growth (new mechanic chapters), not missing work.

**✅ Built**
- Offline bake pipeline (`scripts/build-levels.ts`, `npm run build:levels`) → **60 levels committed**
  in `src/game/levels.data.ts` + debug provenance sidecar (`scripts/levels.provenance.json`).
- **v2 difficulty-first model**: `SHAPES` menu (small/tall/medium/large), size-normalized composite
  score (`src/game/difficulty.ts`), `assignSlots` with shape-rotation + within-chapter monotonicity,
  ease-in curve + rising per-chapter floor (`targetPercentile`), 3 score-based phase labels.
- **Metrics**: exact optimal, forced-move ratio, **dead-end density**, **dig depth** (chapter-1
  concealment burden) — the full metric set is now shipped.
- **Tall 5-tube boards** (capacity up to 12), render-verified on mobile.
- **Runtime loader** extracted to `src/game/levelLoader.ts` (`getLevel` → baked or `generateBestLevel`)
  and excluded from the staleness hash, so live-gen tuning no longer forces a re-bake.
- **Live budget + spinner**: `generateBestLevel` (250 candidates prod / 24 tests), memoized; store
  `loading` flag + deferred generation + `components/Loader`.
- **Endless "Play Random Hard"**: `generateRandomHard` (hard shape + union of all `MECHANIC_SETS`,
  best-of-N); store `mode: 'campaign' | 'endless'` + win-streak tracking; persisted `randomHardBestStreak`;
  Home button gated on `furthest > BAKED_LEVEL_COUNT`; endless-aware header + win overlay.
- **Staleness guard** (`scripts/levelVersion.ts` + `baked.test.ts`) and the full test suite.
- **Concealment scaling**: `concealableLayers(capacity)` in `hidden.ts` — tall tubes hide deeper
  (cap 12 → 7 layers), standard 4-high tubes unchanged (3).
- **Phase-3 weights**: `compositeScores` uses documented `SCORE_WEIGHTS` (dead-end density 1.5×,
  tightness 0.6×) instead of a flat blend.
- **Docs**: README "Architecture" rewritten for the v2 baked-levels + endless model.

**Future (by feel / growth, not gaps)**
- Re-tune `SCORE_WEIGHTS` / `CURVE` knobs from real playtests, then re-bake.
- New mechanic chapters (extend `MECHANIC_SETS` + raise the baked `K`); the endless mode picks up new
  mechanics automatically (it uses the cumulative union).
- Minor cleanup: `src/game/levels.ts` (old tube-count tiers) is now used only by its own test — dead
  production code, safe to remove.

---

## Why this is worth doing

Today every quality dial is throttled by one constraint: generation runs **on the main thread when
a level loads**, and must feel instant on a phone (<100ms — see `scripts/benchmark-generation.ts`).
That ceiling forces three compromises in `generator.ts` / `progression.ts`:

| Dial | Today (runtime budget) | Offline (no budget) |
| --- | --- | --- |
| `PAR_SAMPLE_CAP` | stop after **50** solvable candidates | search **thousands** of seeds per slot |
| `parMode` for Normal/Hard | **DFS proxy** length (exact BFS explodes) | **exact optimal** on every board size |
| `EXACT_OPTIMAL_MAX_BOTTLES` | exact star ref only for 5-tube Easy | exact star ref **everywhere** |
| candidate selection | "first board over a cheap proxy floor" | **score + select against a target curve** |

Offline we can afford all of it. The payoff is a *deliberately shaped* difficulty ramp and
*accurate* star thresholds, instead of the current "seed noise above a floor."

### The key enabler: the runtime barely uses the generator's output

The store consumes only `state`, `hidden`, `optimal`, `phase`, `mechanics`, `par`. It **never reads
`solution` at runtime** — the solution is used solely *inside* generation (solvability proof,
`cappedSolveMoves`, and `exposableCells` for hidden placement), all of which collapse into the
baked `hidden` grid and `optimal`.

So a baked level is tiny: a board (≤15×4 color ids) + a boolean hidden grid + a few numbers.
~1 KB raw per level; **60 levels ≈ 60 KB raw, ~10–15 KB gzipped.** Bundle cost is a non-issue.

---

## Design decisions (options + recommendation)

### 1. Bake everything vs. hybrid bake + live tail

- **(A) Hybrid — bake the authored levels, generate the endless tail.** ✅ Recommended.
  Bake levels 1..K (where mechanics and a tuned curve matter). For K+1..∞ fall through to the
  existing `generateForLevel` (today's plateau is just seed variety at the top rung anyway).
- (B) Bake a fixed finite list only. Loses endless play; no reason to give that up.

**Recommendation: (A).** K = 60 to start. The runtime entry point becomes "table lookup, else
generate."

### 2. Storage format

- **(A) Generated `.ts` module** (`src/game/levels.data.ts` exporting a typed array). ✅ Recommended.
  `tsc` validates the shape at build time; no runtime parsing/validation; tree-shakeable; clean diffs.
- (B) `.json` imported via Vite. Smaller-looking, but needs a runtime cast/validator and gives up
  compile-time shape checking.

**Recommendation: (A)** — a committed, typed module. (If size ever bites, switch the payload to JSON
and lazy-load; the loader seam below makes that swappable.)

### 3. Pipeline: build-step vs. committed artifact

- **(A) `npm run build:levels`, run manually, commit the output.** ✅ Recommended.
  Reviewable diffs, reproducible deploys, `deploy.yml` untouched, no build-time compute blowup.
- (B) Regenerate during `vite build` in CI. Slower deploys, opaque (data never reviewed), and
  non-deterministic unless seeds are pinned anyway — so it buys nothing over (A).

**Recommendation: (A).** Guard staleness with a sync test (see Testing).

### 4. Reuse the existing planner

The script **must** reuse `planForLevel` for footprints, seeds, and mechanics, so baked levels are
the same *kind* of board the runtime would have produced — just selected with a bigger budget. The
script is essentially `generateForLevel` with the dials turned up and the result written to disk.

---

## How this makes the progression better (the real point)

Right now `parFloorFor` sets a *minimum* par and `generateLevel` returns the first board that clears
it (capped at 50 samples, proxy-scored). That's a floor, not a curve — adjacent levels jump around.

Offline we can do **target-curve selection**:

1. **Define a difficulty target per slot.** Within a chapter the `LADDER` already sweeps the
   footprint easy→hard over the 30 levels. On top of that footprint step, define a smooth target for
   a real difficulty metric (e.g. exact optimal move count) that rises monotonically across the
   chapter, and resets per chapter.
2. **Sample wide.** For each level, generate from many seeds (salt-varied), keeping every solvable
   candidate.
3. **Score each candidate** with a difficulty metric (below).
4. **Select** the candidate whose score best matches the slot's target, subject to a
   **monotonicity constraint** (level N+1 is never easier than level N within a chapter).

### Difficulty metrics to consider

Primary (cheap, exact offline):

- **Exact optimal player moves** — `optimalCappedMoves` (hidden-aware A* in `search.ts`) for *all*
  sizes, not just ≤8 tubes. The single best scalar signal; longer ≈ harder.

Secondary (texture — disambiguate boards with equal optimal):

- **Branching factor** — avg legal moves per state along the solve. More choice = more confusion.
- **Forced-move ratio** — fraction of states with exactly one sensible move. *Lower* = harder (more
  real decisions, fewer "obvious" auto-moves).
- **Dead-end / trap density** — sample wrong moves; fraction that lead to unsolvable states, and how
  deep the trap runs before it's clearly lost. Higher = more punishing.
- **Initial entanglement** — how mixed the starting board is (runs ÷ colors).

Hidden-chapter extras:

- **Dig depth** — how many concealed cells, how deep, and how much surfacing the optimal solution
  forces. This is what makes hidden levels feel hard independently of color count.

**Decision: ship all four metrics before deploy** (exact optimal, forced-move ratio, dead-end
density, plus dig depth for hidden). We do this **in phases** to de-risk, but the deployed bake uses
the full set — not a v1 subset:

- **Phase 1 — harness + primary signal.** Build the offline pipeline (budget-parameterized core,
  target curve, selection, data emit, loader, tests) ranking by **exact optimal moves** with
  **forced-move ratio** as a tiebreaker. This proves the end-to-end flow cheaply.
- **Phase 2 — punishing-difficulty signals.** Add **dead-end / trap density** (sample wrong moves,
  measure how often and how deeply a board punishes mistakes) and, for chapter 1, **dig depth**.
  These are the strongest "feels hard" signals and the most expensive — the offline budget is what
  makes them affordable.
- **Phase 3 — re-bake & tune.** With all metrics live, tune weights and the curve, bake the final 60,
  eyeball the ramp, deploy.

Sampling budget is intentionally generous (quality over bake time — see Decisions): search a large
number of salted seeds per slot so the selector has a rich candidate pool for every metric.

### Combining metrics into one selection

Each candidate yields a vector of metric scores. The selector reduces it to a single fitness:

1. **Normalize** each metric across the candidate pool for the slot.
2. **Composite score = roughly equal blend** of the normalized metrics (optimal-moves distance to the
   curve, dead-end density, forced-move ratio, and — in chapter 1 — dig depth), each pulling toward
   its harder direction. **Decision: equal weighting** to start; it's the most balanced and leans
   hardest on Phase-3 tuning, which is fine since the offline budget lets us iterate freely.
3. **Constraint:** never pick a board that breaks within-chapter monotonicity of the headline metric
   (optimal moves, and dig depth for hidden).

Weights live in a small, documented table so the equal-blend starting point stays easy to retune in
Phase 3.

### Concrete curve, chapter 0 (base, L1–30)

Footprint steps are fixed by `LADDER`; the per-slot optimal target rises within each rung and across
rungs:

| Levels | Footprint | Phase | Selection target |
| --- | --- | --- | --- |
| 1–5 | 3c / 5b | easy | exact optimal; gentle ramp, exact stars |
| 6–10 | 4c / 5b | easy | exact optimal; slightly higher |
| 11–15 | 7c / 10b | normal | exact optimal (now affordable offline) |
| 16–20 | 8c / 10b | normal | higher within-rung target |
| 21–25 | 11c / 15b | hard | exact optimal (today proxy-only) |
| 26–30 | 12c / 15b | hard | top of the base curve |

Chapter 1 (L31–60) re-runs the same footprints with `hidden` on top; the curve additionally ramps
**dig depth** so the mechanic's difficulty grows across the chapter, not just the color count.

### Curve shape: ease-in per chapter, with a rising per-chapter floor

**Decision:** within each chapter the difficulty target **eases in** — the first levels of a chapter
are gentle so a newly introduced mechanic gets room to breathe — but **later chapters start from a
higher floor**, so even the "easy" early levels of chapter 1 are harder than chapter 0's.

Concretely the per-slot target is:

```
target(level) = chapterFloor(chapter) + easeIn(posInChapter / CHAPTER_LEN) * chapterSpan(chapter)
```

- `easeIn(t)` is a curve that's shallow near 0 and steeper later (e.g. `t^1.5` or smoothstep), so the
  opening levels ramp gently and the back half climbs faster.
- `chapterFloor(chapter)` rises with chapter index — chapter 1's easiest level sits above chapter 0's
  easiest, partly from the mechanic itself and partly from a deliberate baseline lift.
- `chapterSpan` is how far the target climbs across the chapter (can also grow per chapter).

These three knobs (floor, span, ease-in exponent) are a small documented table tuned in Phase 3.

---

## Revised model (v2): difficulty-first, size-decoupled

> Supersedes the "footprint ladder sets the difficulty" framing above for **selection**. The
> `LADDER`/footprint idea survives only as a *menu of board shapes*, not as a difficulty ramp.

**Why:** tube count is a footprint, not a difficulty. A 5-tube board can be brutal; a 15-tube board
can be a pushover. Since the bake measures difficulty *exactly* and offline, it shouldn't lean on
tube count as a proxy at all. Instead: generate a big pool of boards across many shapes, **score each
by difficulty, sort, and assign to the curve** — letting board size *vary within* every difficulty
band.

### The crucial change: a size-normalized difficulty score

Raw optimal-move count is dominated by size (more colors ⇒ more moves), so sorting by it just
recreates the tube-count ordering. Ranking instead uses a **composite difficulty score** built from
mostly size-independent signals:

- **dead-end / trap density** — how easily a move becomes unrecoverable (a probability)
- **forced-move ratio** (inverted) — more free choices ⇒ harder (a ratio)
- **moves-per-color** — `optimal / colors`: solution depth *relative to* board size
- **tightness** — `1 − empties/colors`: less spare room ⇒ harder
- (chapter 1) **dig depth** — concealment burden

Raw `optimal` is still stored as the star reference; **ranking uses the normalized score.** This is
why dead-end density + forced-move ratio are *primary* under v2, not texture.

### Variation space (the shape menu)

Per chapter, candidates are drawn from a menu of shapes `(tubes, colors, capacity, empties)`:

- **Small-classic:** 5 tubes, capacity 4, 1–2 empty.
- **Small-TALL:** 5 tubes, **capacity swept up to ~12** (kept only where solvable), 1–2 empty —
  **tall tubes are 5-tube-only** (Decision). Few tubes but very dense ⇒ a compact hard board. This is
  the main new difficulty axis.
- **Medium:** 8–10 tubes, capacity 4, varying empties.
- **Large:** 12–15 tubes, capacity 4, varying empties.

Capacity > 4 is confined to 5-tube boards; everything else stays at the classic height of 4.

### Selection algorithm (v2)

1. For each chapter (mechanic set), generate a large candidate pool **across all shapes** (+ seed
   variety); compute hidden where the chapter calls for it; score each with the composite.
2. **Sort by difficulty score.** The ease-in curve (above) now targets a **score percentile** over
   this whole-chapter pool, per slot.
3. Walk slots easy→hard; for each, pick a candidate near the target score, **rotating shapes** so a
   band mixes a tricky little board, a sprawling one, a tall one at similar difficulty (Decision:
   rotate shapes, don't repeat back-to-back). Monotonicity on the score is preserved.
4. **Labels** (`easy`/`normal`/`hard`) are derived from the chosen board's **score bucket** (Decision:
   3 buckets), not its tube count.

### Implications / surface area

- **`progression.ts` is reworked:** `LADDER` → a shape menu; `phase` is computed from score, not
  footprint; `planForLevel`'s job shrinks to "which chapter (mechanics)" + curve target. Baked data
  is the source of truth for the campaign order.
- **Capacity > 4 rendering** (`Bottle.tsx`, `useBottleMetrics.ts`, hidden overlay,
  `CONCEALABLE_LAYERS`) must handle up to ~12 segments on a phone. **Decision: spike this first**
  before baking tall shapes in.
- **Live tail + endless mode** pick from the shape menu at high difficulty (no fixed footprint to
  fall back on).
- **Generation cost** rises (more shapes × seeds, capacity sweep, dead-end sampling) — fine offline.

---

## Data schema (per baked level)

```ts
interface BakedLevel {
  level: number;            // 1-based campaign level
  state: GameState;         // initial board (bottles + capacity), generator-canonical colors
  hidden: HiddenGrid;       // boolean[][] parallel to bottles; all-false in chapter 0
  optimal: number;          // EXACT achievable near-optimal player pours (star reference)
  par: number;              // difficulty signal shown to the player
  phase: Difficulty;        // 'easy' | 'normal' | 'hard'
  mechanics: Mechanic[];    // [] or ['hidden']
  // NOT stored: solution (unused at runtime), seed (provenance only — keep in a sidecar/comment)
}
```

Note the runtime currently recolors `state` for display and keeps `initial` canonical — baked
levels store the **canonical** board, exactly like `generated.state` today, so `recolor` keeps
working unchanged.

**Provenance sidecar** — a second, debug-only file (NOT shipped to players) recording *how* each
baked level was chosen: its seed/salt, the full metric breakdown (optimal moves, forced-move ratio,
dead-end density, dig depth), the target it was matched against, and how many candidates were
searched. This is what lets us answer "why does level 23 feel off?" without re-running the search,
and lets us eyeball the whole curve as a table. **Decision: keep it committed** (it's small, and a
reviewable record of the curve is worth more than the tiny repo cost). Lives at e.g.
`scripts/levels.provenance.json`, never imported by `src/`.

---

## Implementation steps

> Mostly DONE — see **Status & remaining gaps** at the top for what's built. Kept here as the
> original sequencing. Note: the runtime loader landed in **`src/game/levelLoader.ts`** (not
> `progression.ts`), which stays bake-config-only; step 6 (endless mode) and dig depth in step 2 are
> the open items.

1. **Extract a budget-parameterized generator core.** Add knobs to `generateLevel` /
   `generateForLevel` (or a new internal variant) for `sampleCap`, force-exact-optimal, and a
   pluggable scorer — so the offline script and the runtime share one code path with different dials.
2. **Difficulty scorer** (`src/game/difficulty.ts`): given a `GeneratedLevel` (+ hidden), return the
   metric vector. Phase 1 = exact optimal + forced-move ratio; Phase 2 adds dead-end density + dig
   depth. Exposes a `composite(scores, weights, target)` reducer used by the selector.
3. **Target curve** (in `progression.ts` or a sibling): `targetFor(level)` → desired metric value,
   derived from rung + position, monotonic within a chapter.
4. **Build script** `scripts/build-levels.ts`:
   - For each level 1..60: `planForLevel`, sample many salted seeds, score candidates, select best
     vs. target under the monotonicity constraint.
   - Emit `src/game/levels.data.ts` (typed array) + a provenance sidecar.
   - `npm run build:levels` in `package.json`.
5. **Runtime loader** (`progression.ts`): `getLevel(level)` → baked table if present, else
   `generateForLevel` (the existing path becomes the tail fallback). Update `gameStore` call sites
   (`loadLevel`, init) to use `getLevel`. Shape returned is identical to `PlayableLevel`.
6. **Endless all-mechanics mode:** a `generateRandomHard()` helper (hardest footprint + union of all
   `MECHANIC_SETS`, fast par path) + a gated UI entry point (see Endless-mode section).
7. **Tests** (see below).
8. **Docs:** update README architecture + the levels/progression memory once landed.

---

## Testing & staleness protection

- **Validity test:** every baked level is well-formed, solvable, win-reachable under capped/reveal
  rules, and `optimal` matches a recompute. (Reuse the invariants already proven in
  `progression.test.ts` / `capping.test.ts`.)
- **Monotonicity test:** within each chapter, `optimal` (and dig depth for hidden) is non-decreasing.
- **Sync/staleness test:** stamp the data with a generator version (hash of the relevant source or a
  bumped constant); a test fails if the committed data is stale, prompting a re-bake. Keep it cheap —
  it should not re-run the full search in CI.
- **Benchmark stays relevant** for the live tail (levels > 60).

---

## Risks & mitigations

- **Generator/planner changes require re-baking** → version stamp + sync test makes staleness loud;
  re-bake is one `npm run build:levels`.
- **Loss of "infinite identical board" purity below K** → bake is reproducible from pinned seeds, so
  it's the same boards, just curated; and progress is keyed by level *number*, so swapping a board
  under a level never corrupts saves (`best`/`stars`).
- **Bundle growth** → negligible (~10–15 KB gzipped for 60); JSON + lazy-load is the escape hatch.
- **Build time of the script** → offline and manual, so a long bake is acceptable (**Decision: favor
  quality over bake time** — generous sampling). Keep it parallelizable per level so a multi-minute
  (or longer) run is fine and re-bakes don't become a chore.

---

## Endless "all-mechanics" mode (post-campaign)

For players who have **unlocked all baked levels**, offer a **Play Random Hard** entry that
**live-generates** a board at the hardest footprint with **all cumulative mechanics** layered on
(today: 12c/15b + `hidden`; grows automatically as chapters add mechanics). This is the natural home
for the runtime generator once the campaign is baked.

Design notes / decisions to confirm:

- **Live-generated on device** (can't pre-bake an endless stream). It's one board on demand, so the
  old load-time budget concern is minor — but the hardest footprint with all mechanics is also the
  most expensive to generate and to compute exact stars for. Likely use the **fast par/optimal path**
  (proxy + capped upper bound) here, as the live tail does today, rather than exact A*.
- **Mechanic set = the union of all defined chapters' mechanics**, derived from `MECHANIC_SETS`, so
  this mode never needs manual updates when a chapter ships.
- **Progression:** boards are random so there are no per-level stars, but **persist a small stat**
  (Decision) — e.g. best-stars-on-a-random-hard and/or a longest win streak — so the mode has a goal.
  Stored alongside the existing `magic-color:v1` progress.
- **Entry point:** a **dedicated button on the Home screen** (Decision), shown only once
  `furthest > K` (all baked campaign levels cleared). Working label **"Play Random Hard"** (final
  wording TBD).

---

## Decisions locked in

- **Hybrid:** bake the authored campaign (K = 60 to start), live-generate the tail and the endless
  all-mechanics mode.
- **Sampling:** generous — prioritize level quality and a clean ramp over bake time.
- **Metrics:** ship **all** of them (exact optimal, forced-move ratio, dead-end density, dig depth),
  delivered in phases but all present at deploy.
- **Curve:** **ease-in within each chapter**, with a **rising per-chapter floor** so later chapters
  start harder even on their early levels.
- **Provenance sidecar:** **committed**, debug-only, never imported by `src/`.
- **K growth:** extend K as new mechanic chapters are authored and baked.
- **Endless mode:** add a **Play Random Hard (all mechanics)** option, unlocked after all baked
  levels are cleared.
- **Metric weighting:** start with an **equal blend** of all metrics (retune in Phase 3).
- **Endless tracking:** **persist a small stat** (best stars / longest streak on random-hard).
- **Endless entry point:** a **Home-screen button**, gated on clearing all baked levels.
- **Re-bake trigger:** **sync test only** — a failing test prompts a manual local `npm run
  build:levels`; no CI auto-rebake job.

### v2 (difficulty-first) decisions

- **Rank by a size-normalized composite score**, not raw move count; sort the whole-chapter pool and
  assign to the curve by score percentile.
- **Board size varies within every difficulty band** (shape menu, not a footprint ladder).
- **Tall tubes (capacity > 4) only for 5-tube boards**, capacity swept up to ~12 where solvable — a
  compact hard variation.
- **Shape rotation within a band** (avoid repeating a shape back-to-back).
- **Labels = 3 score buckets** (easy/normal/hard derived from the difficulty score).
- **Render spike first** for capacity > 4 before baking tall shapes in.

### Live generation budget & spinner (instant no longer required)

- **Baked levels (1..60) load instantly.** For the live tail / un-baked levels, **instant is no
  longer a requirement** — a **~1–2s generation budget** buys a much better board.
- `getLevel` → `generateBestLevel`: samples `LIVE_POOL_SIZE` candidates and picks the best fit for the
  level's curve target via the size-normalized composite score (no dead-end sampling — too slow per
  load). Memoized per level. **Pool 250 in production, 24 under tests** (VITEST guard) so the suite
  stays fast. `generateForLevel` remains the light single-board generator for tests/bake.
- **Spinner:** store `loadLevel` flips `loading:true` and defers the (blocking) generation a
  macrotask so the compositor-animated CSS spinner (`components/Loader`) paints first; `GameScreen`
  renders it in place of the board while loading. Baked levels skip all this (synchronous).

All open questions are resolved. v2 selection + live budget/spinner are BUILT; remaining: endless
mode, dig-depth metric.
