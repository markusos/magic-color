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

### 3. Tame the non-null-assertion sprawl (TS safety net)

`noUncheckedIndexedAccess` is on (good), but ~100 `!` assertions across `game/` + `store/` opt straight
back out of it at nearly every array access (`state.bottles[from]!`, `arr[i]!`, …). Most are provably
safe inside bounded loops, but each is a latent trap: a refactor that shifts a bound keeps the `!` and
converts a compile error into a runtime crash. Lower the count where it's cheap — e.g. destructure
loop iterands, or add a tiny audited accessor for the genuinely-bounded hot paths — and keep `!` only
where the invariant is local and obvious. Non-functional; no re-bake.

### 4. Centralize `Color` brand casts (TS)

The brand is undermined at its edges by scattered `as Color` / `as Color[]` casts — palette init
([generator.ts:32](src/game/generator.ts)), baked deserialization ([levelLoader.ts:348,366](src/game/levelLoader.ts)).
Each is an unchecked trust point. Funnel a single `toColor`/`asPalette` factory so there's one audited
place raw strings enter the branded type. Non-functional; no re-bake.

### 5. Split the `gameStore` god-closure (SRP)

`gameStore.ts` (517 lines, [src/store/gameStore.ts](src/store/gameStore.ts)) mixes campaign-persistence
mirroring, level-generation orchestration, palette recoloring, status computation, **and
`deferAfterPaint`** — a `requestAnimationFrame`/`setTimeout` DOM-timing scheduler. That paint-deferral
is a pure UI-platform concern living inside the state store: the clearest SRP violation and the hardest
piece to unit-test. Extract it (and ideally the recolor helper) into its own module the store depends
on. Non-functional; no re-bake.

### 6. DRY the fresh-attempt state assembly (DRY/OCP)

`applyLevel`, `applyRandom`, and the inline `startLevel` setup each hand-build the same ~15-field reset
object (`history: []`, `moves: []`, `undos: 0`, `visited: new Set(...)`, `selected: null`,
`boardNonce + 1`, …) — three copies that must stay in sync; adding a per-attempt field means editing
all three. Extract a `freshAttempt(generated, recolored)` builder. Non-functional; no re-bake.

### 7. Collapse the long positional parameter lists in `levelLoader` (clarity)

`optimalFor` / `cutoffsFor` / `toPlayable` ([levelLoader.ts:53,75,110](src/game/levelLoader.ts)) each
take `(state, solution, hidden, bottles, capacity, funnels)` — six positional args, several derivable
from the `GeneratedLevel`. Easy to transpose `bottles`/`capacity` at a call site. Pass the generated
object (plus the overlays) instead. Non-functional; no re-bake.

**Suggested order:** #1 and #2 first (they compound and cut bake time, do them in one re-bake), then the
no-re-bake refactors #3–#7 opportunistically.
