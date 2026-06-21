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
little gain. Behavior-preserving (full suite green); non-functional; no re-bake. Non-functional; no re-bake.

### 7. Collapse the long positional parameter lists in `levelLoader` (clarity)

`optimalFor` / `cutoffsFor` / `toPlayable` ([levelLoader.ts:53,75,110](src/game/levelLoader.ts)) each
take `(state, solution, hidden, bottles, capacity, funnels)` — six positional args, several derivable
from the `GeneratedLevel`. Easy to transpose `bottles`/`capacity` at a call site. Pass the generated
object (plus the overlays) instead. Non-functional; no re-bake.

**Suggested order:** #1 and #2 first (they compound and cut bake time, do them in one re-bake), then the
no-re-bake refactors #3–#7 opportunistically.
