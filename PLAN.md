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

# Chapter 3 — Frozen colors (ice)  ← BUILT (2026-06-22)

**BUILT.** All 240 levels baked (version `7bc4fbb165d8c0ce`); chapters 0–2 reproduced byte-identically
(only the new all-null `ice` field added). `MECHANIC_SETS[3] = ['hidden','funnel','ice']`,
`DEFINED_CHAPTERS = 4`, `CAMPAIGN_LENGTH = 240`, chapter 3 = levels 181–240, name "Deep Freeze".
Lint/tsc/200 tests green; ice render verified in the browser. As-built notes in the `ice-mechanic`
memory. The design write-up below is kept for rationale.

One v1 scoping note vs. the plan: the full-information DFS solver (`solver.ts`) was **not** made
ice-aware — it only feeds heuristic difficulty signals (`forcedMoveRatio`/`deadEndDensity`) and the
"circling" nudge, none correctness-critical, and a correct port would mean rebuilding its bulk-pour /
structural-win model into a capped+thaw-aware one. Those heuristics measure the un-iced board (a
conservative under-estimate); the `iceLoad` term carries the ice pressure into the difficulty blend,
and the exact par/stars (`search.ts`) ARE ice-aware.

The mechanic chapter. Cumulative on top of hidden + funnel:
`MECHANIC_SETS[3] = ['hidden','funnel','ice']` ⇒ `DEFINED_CHAPTERS = 4`, `CAMPAIGN_LENGTH = 240`,
chapter 3 = levels 181–240 (UI "Chapter 4").

## The mechanic (player-facing)

A tube can start with its **bottom region frozen in a single block of ice** — the bottom `k` segments,
from the floor up to an "ice line." The frozen block:
- **cannot be poured, and blocks everything below the ice line** — you pour the free liquid *above* the
  ice normally, but nothing at or below the ice line moves until it thaws, and
- **keeps its tube from being capped** (a tube holding ice is never "finished"), like a hidden `?`.

**Freeze the whole region, not just the blocking cell.** Mechanically, only the *topmost* frozen
segment matters — it already blocks every segment beneath it, and those can't move regardless. So we
freeze the entire bottom region down to the floor and render it as one ice block. This is **purely
visual: the solver behaviour is identical** whether we mark only the topmost frozen cell or fill the
whole region (the run-cap stops at the ice line and capping is blocked either way). It just reads far
better — one clean frozen block per tube instead of a checkerboard of frozen/free cells.

The ice block is **tinted with a single trigger color** and **thaws all at once the instant that color
is completed** — the moment any tube is capped with the trigger hue. The tint *is* the liquid color
that melts it, so the rule is readable at a glance: *"finish blue and the blue ice melts."* This
tint↔thaw tie is the chapter's headline UX requirement (see **Visuals**) — and the underlying liquids
must stay visible *through* the ice so you can still read the segments you're about to free.

The new axis vs. earlier chapters: hidden hides *information*, funnels constrain *destinations*, ice
constrains **timing/order** — you must complete colors in an order that melts each cell's ice before
you need what's under it. Chained ice (cell A's trigger frees a tube that caps a color which frees
cell B) produces the satisfying "unlock cascade."

## Key architectural decision: ice is DERIVED, threads like `funnel` (not `hidden`)

Earlier I assumed ice would need a new search-state dimension like `hidden`'s evolving concealment.
It does **not** — and this is the central simplification of this plan:

> A color is "completed" ⟺ a capped tube of that color **currently exists** on the board. Capping is
> permanent (a capped tube is finished, never poured), so "ever completed by now" ≡ "a capped tube of
> that color exists now." Therefore the **current frozen state is a pure function of `(board, hidden,
> static trigger grid)`** — nothing to remember between moves.

Consequences:
- The static datum is a per-cell **`IceGrid = (Color | null)[][]`** (the trigger tint, or `null`),
  shaped like `HiddenGrid`, with a **contiguous-bottom invariant**: within a tube, frozen cells form an
  unbroken block from index 0 up to the ice line, and **all share one trigger color** (they thaw
  together). The per-cell shape (rather than a per-tube `{depth, trigger}`) keeps it parallel to
  `HiddenGrid` so shuffle/recolor/render reuse the existing patterns; the invariant is just something
  the generator maintains. It is **immutable per game** (never edited mid-play), so it threads through
  the solver/metrics as **one optional `ice?` param exactly like `funnels?`** — default `undefined` ⇒
  chapters 0–2 behave byte-identically.
- **The solver only reads the topmost frozen cell per tube** (the ice line): the run-cap helper stops
  there and `isCapped` rejects any tube with a frozen cell. Filling the block below the ice line is
  invisible to search, so it costs nothing and the solvability proof only has to hold for the ice line.
- **`stateKey` does NOT grow.** Two boards with the same bottles+hidden have the same completed-color
  set, hence the same frozen state. No extra search-state dimension, no per-node ice payload (unlike
  `revealExposed`, which must thread `hidden` through nodes). This makes ice as cheap to search as
  funnels.
- A small helper **`frozenCells(state, hidden, ice): boolean[][]`** computes the live frozen booleans
  from those three inputs. Cascades need a **bounded fixpoint** (a color completing can free ice that
  lets another tube cap, completing another color…): start from tubes that are capped *and* ice-free,
  collect their colors, thaw ice whose trigger is in that set, re-scan; iterate to fixpoint (≤ #colors
  rounds — cheap). The fixpoint depth is exactly the cascade depth and feeds the difficulty term.

## Solvability by construction (the `exposableCells` analogue)

Ice placement is derived from the level's stored full-information solution, so replaying that solution
always thaws every cell in time ⇒ the board stays provably solvable.

Because only the ice line is load-bearing, the derivation is per-tube: choose an **ice-line index `t`**
(freeze cells `0..t`) and a **trigger `C`** such that `C` finishes before the topmost frozen cell needs
to move. Cells below `t` thaw at the same instant — no later than they'd ever need to — so freezing
them is always safe.

Derivation — replay the solution once, recording two things:
- `dropIndex[b][i]` = the move index at which bottle `b`'s height first drops to `≤ i` (the moment the
  cell at `(b,i)` must leave / be reachable). Reuse the `minHeight` sweep from `exposableCells`. Note a
  higher `i` (nearer the top) drops *earlier*, so a higher ice line demands an *earlier*-finishing
  trigger — the natural difficulty knob.
- `completedAt[C]` = the move index at which color `C` is first completed (a tube first becomes
  capped with color `C`).

Tube `b` is **ice-eligible at line `t` with trigger `C`** iff `completedAt[C] < dropIndex[b][t]` — the
trigger finishes strictly before the topmost frozen cell must move. (No self-deadlock: the tube that
caps `C` can't be `b` itself, since a capped tube is never later poured, so `b`'s frozen cells couldn't
subsequently move out.)

`computeIce(state, seed, ...)` then, per tube, seed-draws whether to freeze it (à la `computeHidden` /
`computeFunnels`: a draw consumed per tube to keep the RNG stream aligned, its own XOR constant to
decorrelate from the hidden/funnel draws); if so, picks a `t` among the eligible lines and a `C` among
that line's qualifying triggers, then **fills `0..t` with tint `C`**. It **force-freezes one eligible
tube if the draws freeze none** so every ice-chapter level shows the mechanic (mirrors the funnel fix).
Boards with **no** ice-eligible tube stay ice-free and are filtered out of the chapter pool by the bake.

## Restart safety (recolor + shuffle) — the question that motivated this design

Restart re-rolls both **tube order** (`shuffleBottles`) and **color ids** (`recolorBoard`). The
`IceGrid` survives both because the trigger is **keyed by color, never by tube index**:
- **Shuffle** — `IceGrid` is per-cell, parallel to bottles, so it permutes in lockstep as a *fourth*
  array alongside `hidden` and `funnels` in `shuffleBottles`. Color triggers are position-independent,
  so permuting tubes changes nothing about *which* liquid thaws a cell.
- **Recolor** — add **`recolorIce(ice, map)`** (6 lines, mirrors `recolorFunnels`) and have
  `recolorBoard` remap the ice tints through the **same** `randomColorMap` as the board + funnels, so
  the ice tint always matches the recolored liquid. `recolorBoard` returns
  `{ board, funnels, ice }`.
- Reset from a canonical **`initialIce`** on restart (like `initialHidden` / `initialFunnels`), so each
  restart re-rolls afresh.

Both invariants the solvability proof relies on — *"finish C before cell (b,i) moves"* — are preserved:
shuffle moves where things are but not when they happen; recolor is a consistent bijection over board
+ ice tint. (See `funnels-mechanic` memo gotcha: store-injected test boards must also reset
`ice`/`initialIce`, or they inherit a loaded level's grid.)

## Difficulty term: `iceLoad`

Add a 7th metric term, gated into the `compositeScores` blend the same way `funnelLoad` is (folded in
ONLY when the pool has any ice, `pool.some(m => m.iceLoad > 0)`, so chapters 0–2 re-bake byte-identically
— do NOT shift the denominator otherwise). Definition: a size-decoupled ratio combining **how much** is
frozen (iced-cell fraction) and **how deep the cascade goes** (the `frozenCells` fixpoint depth, the
real source of ordering pressure). Start simple (iced fraction), add the cascade-depth weight once
playtested. Note `forcedMoveRatio`/`deadEndDensity`/`optimal` already tighten automatically once `ice`
is threaded through the solver, since frozen cells prune real moves.

## Implementation steps (ordered)

1. **`src/game/ice.ts`** (new) — the mechanic module, mirroring `funnels.ts`/`hidden.ts`:
   `IceGrid` type; `noIce(state)`; `anyIce`; `frozenCells(state, hidden, ice)` (the bounded-fixpoint
   derivation); `iceEligibleLines(state, solution)` (per-tube `dropIndex`/`completedAt` → eligible
   `{line, trigger}`); `computeIce(state, seed, eligible)` (seeded per-tube freeze, **fill `0..t` with
   the trigger tint**, force-one-tube fallback); `recolorIce(ice, map)`; `iceLoad(ice, colors,
   cascadeDepth)`. Pure, fully unit-tested in isolation.
2. **Run/cap rules consult frozen cells.** Generalize the run-cap + capped checks so a frozen cell
   blocks the top run and prevents capping — the cleanest path is an ice-aware run helper used wherever
   `knownTopRun` is today (`search.cappedSuccessors`, `gameStore.tapBottle`), and an `isCapped` that
   also rejects tubes with a remaining frozen cell. Keep `hidden`'s behaviour identical when `ice` is
   absent.
3. **Thread `ice?` through the solver/metrics** exactly like `funnels?` (default `undefined` ⇒ no
   change): `solver.ts` (`SolveOptions.ice` → `isUsefulMove`/`usefulMoves`/`search`/`isUnsolvable`/
   `bfsOptimal`), `search.ts` (`cappedSuccessors`/`optimalCappedMoves`/`nearOptimalCutoffs` — frozen
   set recomputed per node from `(state, hidden, ice)`, NOT carried in the node or `stateKey`),
   `difficulty.ts` (`measureMetrics` + the `iceLoad` term + gated `compositeScores`).
4. **Empties-pruning soundness.** Re-check the "only consider the first empty" pruning in
   `solver.isUsefulMove` and `search.cappedSuccessors`: it was already made color-specific for funnels;
   confirm ice doesn't reintroduce an unsound representative (ice never makes an empty *destination*
   illegal, so this is likely a no-op — verify with a test, don't assume).
5. **Store wiring** (`gameStore.ts`): carry `ice` + `initialIce`; gate `tapBottle`/`noPlayerMove` via
   the frozen check; `recolorBoard`→`{board,funnels,ice}`; `shuffleBottles` 4th array; `freshBoardState`
   + restart re-roll include ice; reset injected boards' `ice`/`initialIce` in tests.
6. **Types + progression + chapters**: `Mechanic` gains `'ice'`; `MECHANIC_SETS[3]=['hidden','funnel',
   'ice']`; `CHAPTER_NAMES` adds `'Frozen'` (or similar). `baked.ts` `BakedLevel`/`PlayableLevel` gain
   `ice: (string|null)[][]`; `levelLoader.ts` deserializes it through `toColors`-style branding;
   `levelVersion.ts` `SOURCES` adds `src/game/ice.ts`.
7. **Bake** (`build-levels.ts`): for the ice chapter, filter the candidate pool to boards with
   `ice.some(col => col.some(t => t != null))` before `assignSlots` (mirrors the funnel filter), so
   every level shows ice. Add `ice` to the per-board worker output + `BakedLevel` emission + the debug
   line.
8. **Visuals** (`Bottle.tsx` + `Bottle.module.css`) — see below.
9. **Re-bake** all 240 (`npm run build:levels`); confirm chapters 0–2 reproduce byte-identically (only
   the version hash changes) and `baked.test.ts` passes; run the `benchmark` skill to confirm the live
   path stays within the spinner budget.

## Visuals (the headline UX requirement)

The ice must look like **the tube is genuinely encased in ice**, tinted by the unlock color, with the
**real liquids still visible through it** — not a flat color swatch replacing the segments.

- Render the frozen region as **one continuous ice block** spanning the contiguous bottom cells (the
  per-tube contiguous-bottom invariant is what lets this be a single clean overlay, not per-cell
  patches). The underlying liquid segments render **normally underneath**; the ice is an *additive,
  translucent* layer on top so each frozen segment's true color reads clearly through the frost.
- Tint the ice with the **trigger color** via a `--ice` CSS var (= the trigger's cssColor), same
  plumbing as the funnel collar's `--funnel`. Keep it translucent / use a blend (e.g. screen or
  low-opacity overlay) so the tint colors the *frost* without hiding the liquid beneath — the player
  sees "blue-iced red+green liquid," reading both the segments and what melts them.
- Sell the "ice" with texture, not just opacity: a crystalline/cracked-glass pattern, soft white
  highlights/specks, and a crisp brighter **rime line at the ice line** (the top edge of the block) so
  the frozen/free boundary is obvious. A small snowflake motif in the trigger color reinforces the tie.
- On completion of the trigger color, play a **shatter/melt** of the whole block at once, revealing the
  now-free liquid. Consider a subtle pulse on a block whose trigger just became *completable*.
- Accessibility: don't rely on hue alone — pair the tint with the frost texture so a frozen block is
  distinguishable from a hidden `?` and from funnel rims for color-deficient vision.
- Verify in the live preview (preview_* tools) that underlying liquids stay legible through the ice,
  across a frozen board, a mid-thaw shatter, dark mode, and a small viewport before calling it done.

## Tests (`src/game/ice.test.ts` + store tests)

Eligibility derivation (line-vs-completion ordering); `computeIce` per-tube freeze + force-one fallback
+ RNG-stream alignment + **contiguous-fill invariant** (a frozen tube is an unbroken bottom block of one
tint); `frozenCells` fixpoint incl. a multi-step cascade and a no-cascade board; `recolorIce` lockstep
with the board map; **solvability** (the stored solution thaws every block and wins) over many
seeds/shapes; **solver-equivalence** — marking only the ice line vs. filling the block below it yields
identical `optimal`/successors (proves fill-down is purely visual); monotonicity (more/higher ice ⇒
`iceLoad`/`optimal` non-decreasing); chapters 0–2 unchanged when `ice` is `undefined`. Store: restart
recolor/shuffle keeps ice tints matched to liquid; pour into/over a frozen block rejected;
injected-board ice reset.

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
  change. **Chapter 3 — Frozen colors (ice) is now BUILT (see above).**

## Re-baking

`npm run build:levels` (≈8 min for the full campaign, deterministic). Any change to a bake-relevant
source bumps the `levelVersion.ts` hash; `baked.test.ts` then fails until you re-bake. Re-baking
reproduces earlier chapters byte-identically (seed-deterministic).

---

## Code-quality review (TypeScript / algorithms / SOLID)

Baseline: lint, typecheck, and all 182 tests pass; the engine/solver/generator split, branded
`Color`, immutable engine, and documented dependency direction are already strong. The items below are
the **highest-leverage** refinements found, ranked by impact. None is a correctness bug — they're
performance, safety-net, and maintainability debt. Anything touching a bake-hashed source forces a
re-bake (must reproduce earlier chapters byte-identically), so each item notes that.

### 1. Make the solver DFS iterative — DONE

`solver.search` ([solver.ts](src/game/solver.ts)) was recursive and rebuilt the path on every node
(`dfs(next, [...path, move])` → O(nodes · depth) allocation, plus a stack-overflow risk on deeply
tangled 15-tube boards at the 200k-node depth). Now an explicit frame stack with a single mutable
`path` (pushed on descend, popped on backtrack); same pre-order traversal and prune order.

Verified: equivalence-tested against the original recursion over 500+ cases (every shape × six node
budgets × ±random funnels, plus hand-crafted boards) — identical solution sequences and `exhausted`
flags. Re-bake reproduced all 180 boards byte-identically (only the `GENERATOR_VERSION` hash changed).
Live-gen benchmark flat (within noise), as expected — the win is stack-safety + reduced bake-path
allocation, not live latency (which is A*/dead-end-bound).

### 2. Cheaper canonical state key — DONE

`stateKey` ([search.ts](src/game/search.ts)) did `map → (inner map+join) → sort → join` over long
palette ids on every visited node, the hottest loop of *every* search variant (DFS, `bfsOptimal`, A*
`optimalCappedMoves`, the tier sweep). Now each color is interned to a single BMP char (codes from
0x100, above the '|'/'?' markers, so no per-cell separator is needed), so a serialized bottle is a
short char string — cheaper to build, sort, and join.

Verified: micro-benchmark ~22–25% faster across large/tall/hidden boards; the old↔new key mapping
proven a bijection over 300+ diverse states (generated boards, random-walk successors, random
concealment), so the equality partition — all that callers rely on — is unchanged. Re-bake reproduced
all 180 boards byte-identically (only the version hash changed) and ran faster (≈431s vs ≈638s, though
not a controlled comparison).

### 3. Non-null-assertion sweep — REVIEWED, not worth doing

Surveyed every postfix `!` in `game/` + `store/` (the original "~100" figure was inflated by `!`
boolean-negations). The genuine assertions are uniformly disciplined and locally justified — each sits
next to the guard/clamp/modulo that makes it safe: `bottle[bottle.length-1]!` after `length > 0`,
`state.bottles[from]!` after `canPour`, Fisher–Yates swaps, `PALETTE[c]!` with `c < PALETTE.length`,
`MECHANIC_SETS[chapter]!`/`LIVE_SHAPES[…%len]!` with clamped/modulo indices, parallel-array reads,
`history[history.length-1]!` after an early empty-return, `CHAPTER_NAMES[idx]!` after a clamp. Each `!`
exists only because `noUncheckedIndexedAccess` can't see a local invariant. Removing them mechanically
means impossible-case fallbacks (which hide future bugs) or guard ceremony — net-negative churn, and
risky in the hot loops. No typed-accessor win either (call overhead in hot paths; overkill for the ~3
clamped-table lookups). Conclusion: leave as-is; the existing usage is correct and idiomatic.

### 4. Centralize `Color` brand casts (TS) — DONE

Added `toColor`/`toColors` to [types.ts](src/game/types.ts) — the audited boundary where an external
raw string (baked deserialization, test fixtures) becomes a branded `Color`. Routed the scattered
casts in [levelLoader.ts](src/game/levelLoader.ts) (baked bottles + funnel tints) and the
[test/board.ts](src/test/board.ts) `color` helper through it. The `PALETTE` literal in `generator.ts`
is deliberately left as the single in-code origin (one definition, one cast) — touching it would bump
the bake hash for no real safety gain, so #4 stays re-bake-free. Non-functional; lint/typecheck/182
tests green.

### 5. Split the `gameStore` god-closure (SRP) — DONE

Extracted the two self-contained concerns out of the store closure:
`deferAfterPaint` (the rAF/setTimeout paint scheduler — a pure browser-timing concern) → new
[src/store/deferAfterPaint.ts](src/store/deferAfterPaint.ts); and `recolorBoard` (board + funnel-tint
recolor under one bijection) → [recolor.ts](src/game/recolor.ts), its natural home (display
recoloring, not bake-hashed), now with an injectable `random` for testability. `gameStore.ts` is
517 → 476 lines and no longer mixes UI timing or recoloring with state. Behavior-preserving (the 31
store tests + full suite stay green); non-functional; no re-bake.

### 6. DRY the fresh-attempt state assembly (DRY/OCP) — DONE

`applyLevel` and `applyRandom` hand-built the same ~17-field reset object. Extracted a
`freshBoardState(generated, board, funnels)` builder in [gameStore.ts](src/store/gameStore.ts); each
caller now spreads only its mode-specific fields (campaign records vs. the endless `best`/`bestStars`
reset) on top. Adding a per-attempt field is now a one-place edit. The `restart` handler (re-shuffles,
keeps level metadata) and the initial-state object (different shape — full state with un-baked
fallbacks) are deliberately left out: routing them through the builder would need conditionals for
little gain. Behavior-preserving (full suite green); non-functional; no re-bake.

### 7. Collapse the long positional parameter lists in `levelLoader` (clarity) — DONE

`optimalFor` / `cutoffsFor` ([levelLoader.ts](src/game/levelLoader.ts)) took
`(state, solution, hidden, bottles, capacity, funnels)` — six positional args, four derivable from the
`GeneratedLevel` (and `bottles`/`capacity` easy to transpose). Now `(generated, hidden, funnels)`,
destructuring what they need from `generated`; `toPlayable`'s call site drops from a 6-arg spread to
`cutoffsFor(generated, hidden, funnels)`. Behavior-preserving; non-functional; no re-bake.

---

## Review status

All seven items are resolved: #1, #2, #4, #5, #6, #7 done; #3 reviewed and deliberately skipped. The
two algorithm items (#1, #2) each required a re-bake (both reproduced earlier chapters
byte-identically); the rest were non-functional and re-bake-free.
