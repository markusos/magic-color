# SOLID & Code-Quality Review

_A principal-engineer review of the whole repository: SOLID adherence, algorithm choices,
architectural patterns, and a ranked list of improvements. Reviewed 2026-07-14 against
`claude/repo-solid-review-ygfcv3`._

## TL;DR

This is a **well-above-average codebase** — genuinely one of the cleaner hobby-scale game
architectures I've reviewed. The defining decision — the game rules live **once**, in a Rust
crate compiled to both a native bake binary and browser wasm — is the kind of choice most teams
talk about and never make. It eliminates an entire class of "the offline generator and the live
board disagree" bugs by construction, and the team followed through: the JS rule twins were
actually deleted after parity was proven, rather than left to rot.

There are no correctness red flags. The findings below are almost entirely about **maintainability
headroom** and **hot-path efficiency**, not defects. The single most valuable refactor is
decomposing the 934-line `gameStore.ts`; the single most valuable performance lever is reducing
per-node heap allocation in the Rust search core. Both are ranked High below.

---

## What we're doing well (keep doing this)

These are load-bearing strengths. They should be protected in review and used as the template for
new code.

1. **One implementation of the rules (the strongest architectural call in the repo).** `core/` is
   the sole source of truth; it compiles to the native `bake` CLI and to wasm for the runtime. A
   baked board and a live board *cannot* disagree because they run the same code. The freshness
   guards (`coreVersion.test.ts`, `baked.test.ts`) fail the build if a committed artifact drifts
   from the crate — so the "single source" invariant is enforced, not merely intended.

2. **Determinism is treated as a feature, not an accident.** Seeded `mulberry32`, `libm` for the
   difficulty-curve float math (so native and wasm are bit-identical), frozen golden vectors in
   `vectors/*.json`, and comments at every point where enumeration order matters
   (`legal_moves`, the `MinHeap` tie-break port). This is why the port could be validated
   differentially and the JS twins retired with confidence.

3. **Clean dependency direction (DIP) in the store layer.** `gameStore` depends on *abstractions*:
   the `Campaign` interface, the `session` adapter, `levelLoader`. It never touches
   `localStorage` — persistence is fully behind `campaign.ts` → `progress.ts`. Swapping storage or
   the rules backend would not touch the store's decision logic.

4. **Real SRP at the service seam.** The progress stack is layered exactly right: `progress.ts`
   (pure, immutable shaping — load/parse/merge/record) vs. `campaign.ts` (the thin stateful
   "hold the blob, persist on change" layer) vs. `gameStore` (board play). Settings persistence is
   a separate store under a separate key so the two blobs can never collide. `progressStats.ts` is
   a pure read-model.

5. **A cohesive, allocation-light wasm boundary.** The flat-byte protocol (no serde/JSON across the
   boundary) plus the `Board` handle — decode once in the constructor, then call
   `hint`/`view`/`tap`/`force_pour` — is the right shape. The doc comment even records *why* it
   replaced four functions that each repeated the 6-arg encode prefix. `withBoard()` on the JS side
   mirrors this with guaranteed `free()`.

6. **A genuinely strong internal state representation.** `Tube` as `[u8; 10] + len` (`Copy`, no
   heap), concealment as a `u16` bitmask, the canonical key as a sorted `Vec<u128>` of
   `(packed, hidden)` words with the equivalence-class argument written down. Admissible A*
   heuristic `(runs − distinct colors)`. These are informed choices, not cargo-culting.

7. **One quality gate, defined once, run everywhere.** `scripts/gate.ts` is the same module for
   `npm run check`, `exe/test`, and both CI workflows — with concurrent app/core/e2e lanes so wall
   time ≈ the slowest lane. "Passing locally means CI passes" is real here. Conditional steps
   (`verify`, `playwright`) degrade gracefully on their inputs.

8. **The branded `Color` type with a single trust boundary.** `Color = string & { __color }` with
   `toColor` as the one audited cast point stops raw strings (hashes, CSS values, level ids) from
   masquerading as colors, at zero runtime cost.

9. **Comments explain _why_, not _what_.** The board-remount nonce, the counter-rotating liquid
   spring, the iOS-WebKit ice-seam rationale, the "stuck vs. deadlocked vs. unwinnable-but-fresh"
   distinction. This is the documentation that actually saves the next engineer.

10. **Test coverage is broad and meaningful** — 38 test files across the crate and app, including
    differential vector replays and the staleness guards, not just happy-path unit tests.

---

## Findings, ranked high → low

### HIGH

#### H1 — Decompose `gameStore.ts` (934 LOC) — the one clear SRP violation on the TS side

`src/store/gameStore.ts` is the repo's God-object. It currently owns at least four separately
motivated concerns:

- **Board lifecycle** — `loadLevel`/`applyLevel`/`applyRandom`/`applyDaily`/`reloadBoard`/`commit`/
  `freshBoardState`, plus the resume-board construction in the initializer.
- **The tap/undo/restart game loop** — `tapBottle`, `undo`, `restart`.
- **Hint orchestration** — worker lifecycle (`getHintWorker`), the `hintPending` guard, the
  spinner-delay timer, the worker-vs-sync fallback, `recordHint`.
- **The auto-solve state machine** — `autoSolveGen` generation counter, `autoSolveTimer` /
  `autoSolveNoticeTimer`, per-move wall-clock timeout, `live()` liveness checks, cancellation.

The auto-solve and hint blocks alone are ~230 lines of closure-captured mutable state
(`hintPending`, `autoSolveGen`, three timer handles). They are only reachable — and only
testable — *through the store*, which is why they're hard to unit-test in isolation.

**Recommendation.** Extract the two solver-orchestration concerns into their own modules that own
their worker + timers and expose a small imperative API the store calls:

- `store/solverWorker.ts` — the single `getHintWorker()` + a `solve(request): Promise<HintMove|null>`
  that encapsulates the worker/sync fallback (used by both hint and auto-solve).
- `store/autoSolve.ts` — a controller created with `(get, set, solve)` that holds the generation
  counter and timers and exposes `start()/stop()`.

The store shrinks to progression + persistence + the pour loop (its documented job), and the two
controllers become independently testable. This is a maintainability/testability win, not a bug
fix — sequence it as a deliberate refactor with the existing store tests as the safety net.

#### H2 — Cut per-node heap allocation in the Rust search core (efficiency)

`State { tubes: Vec<Tube>, capacity }` is heap-allocated, and it is **cloned on every successor** —
`engine::pour` does `state.clone()` (engine.rs:77), and `pour` runs for every move expanded in
`search`, `bfs_optimal`, and the A* in `search.rs`. Likewise `Key = Vec<u128>` is freshly allocated
**and sorted on every `canonical()`/`state_key()` call** — i.e. once per visited node.

The bounds are already documented and tight: **bottles ≤ 15**, and `Tube` is `Copy`/inline. So both
of the dominant per-node allocations can become inline storage:

- `State.tubes: Vec<Tube>` → `SmallVec<[Tube; 16]>` (or a fixed `[Tube; 16] + len`). `State` becomes
  clone-cheap with no heap traffic per pour.
- `Key = Vec<u128>` → `SmallVec<[u128; 16]>` (15 tubes × 16 B = 240 B on the stack).

This matters because it's the hottest code in the product: live generation runs the solver across a
**pool of ~600 boards** behind a **~1.5s phone spinner budget**, and the bake runs it far more. This
is exactly the kind of change the repo is set up to validate — gate it on the existing
`npm run bench` / `benchmark` skill and the golden vectors so you *measure* the win and prove
behavior is unchanged. Treat it as **benchmark-first**: land the measurement, then the change.

(A smaller companion win: `legal_moves`/`useful_moves` return `Vec<(u8,u8)>` per call; with ≤ 15
tubes the move list is tiny and could also be a `SmallVec`, but H2's two allocations dominate —
start there.)

### MEDIUM

#### M1 — Unify the three board-install paths (DRY)

`applyLevel`, `applyRandom`, and `applyDaily` share one skeleton: `stopAutoSolve()` → generate →
`recolorBoard(...)` → `commit(freshBoardState(...), { mode-specific fields })`. The differences are
only the generator call and the mode fields. Collapse into a single
`installBoard(generated, modeFields)` helper; each caller passes its generator result and the
`{ mode, best, bestStars, ... }` overrides. Removes ~40 lines of near-identical code and one place
to forget a field when a new per-board field is added. (Pairs naturally with H1.)

#### M2 — The render path allocates a full wasm round-trip per `GameBoard` render

`GameBoard` calls `viewOf(current, {hidden,funnels,ice}, selected)` **inline on every render**
(GameBoard.tsx:32). Each call allocates a fresh wasm `Board`, encodes the board + three overlays
into typed arrays, crosses the boundary, and decodes five arrays back. `GameBoard` re-renders on
every change to `current/selected/hidden/funnels/hint/…`, and `selected` flips on *every tap*, so
this runs constantly during play. It's sub-millisecond on a 15-tube board, so this is about
allocation churn, not jank.

Two options, cheapest first:
- `useMemo` the `viewOf` call keyed on its inputs. Low effort; removes recompute when an unrelated
  store field changes.
- Structurally, only `pourTargets` depends on `selected`; `blocked/frozen/capped/status` are
  stable between selection changes. If profiling ever flags this, split the boundary into a stable
  board view + a cheap `pourTargets(selected)` call.

Measure before investing beyond the `useMemo`.

#### M3 — Small logic duplications worth consolidating

- **Phase bucketing.** `phaseForTarget` (levelLoader.ts:225) literally re-implements the
  `< 1/3 → easy, < 2/3 → normal` split from `phaseForLevel` (progression.ts:216). The duplication
  is *deliberate* (to keep the load path out of the bake hash), but the pure bucketer
  `(p: number) => Difficulty` is itself bake-irrelevant. Extract it to a tiny shared,
  non-hashed module and have both call it — you keep the bake-hash boundary and delete the copy.
- **Rust cell encoding.** `generate_live` (wasm.rs:444) re-inlines the exact body of `encode_cells`
  (wasm.rs:342). Call the helper. (There's a third "board → flat cells" in `State::to_board`; the
  wasm boundary layout and the `Board` layout differ enough that unifying all three isn't worth it,
  but the two in `wasm.rs` are identical.)

#### M4 — Move the ice-art data out of `Bottle.tsx`

`Bottle.tsx` is 404 lines, but ~100 of them are static SVG geometry tables (`ICE_FACETS`,
`ICE_CRACKS`, `ICE_BUBBLES`, `ICE_CROWN`, …) with long authoring comments. That's asset data, not
component logic. Lift it into `components/Bottle/iceGeometry.ts` (data + the `coverScaleX` helper).
The component drops to a readable ~300 lines and the "how the crystal is authored" commentary lives
next to the data it documents. Pure SRP/readability; no behavior change.

### LOW

#### L1 — `coreWasm.ts` (496 LOC) mixes codec and API surface

The module holds the byte encoders/decoders (`encodeCells`, `masksToGrid`, `decodeTapPour`, …)
*and* the six public adapter functions *and* the `wasmStuck` object. It's cohesive and well
-documented, so this is low priority, but if it grows further, split
`coreWasm/codec.ts` (pure byte ↔ JS helpers) from `coreWasm/index.ts` (the API). Not worth doing
on its own today.

#### L2 — Test-only exports live in production modules

`generateForLevel` (levelLoader.ts) exists for tests exercising per-chapter generation; the app
path is `getLevel`. This is a common and acceptable trade-off — flagged only for completeness. If
it multiplies, gather such seams behind a `__testonly` namespace or a test helper module.

#### L3 — Minor per-render work in `GameBoard`

`frozen={bottle.map(...)}` rebuilds a per-cell array for every bottle each render. Negligible, and
only worth touching if M2's memoization pass is done anyway (it would ride along).

---

## Algorithm & data-structure notes

The algorithm *choices* are sound; the notes are about their *implementation cost*, already
captured above.

- **Full-information solve** — iterative pre-order DFS with a visited set, deliberately mirroring
  the JS enumeration for reproducibility. Correct choice for "find *a* solution" and for the
  unsolvability proof (exhaustion within budget). ✔
- **Optimal counts** — layered BFS (`bfs_optimal`) for full-info minimum; capped/reveal/overlay-
  aware **A\*** with an admissible heuristic for the player-rule optimum and hints. Appropriate;
  the heuristic is genuinely admissible. ✔
- **Generation** — rejection sampling with best-of-N par floor and canonical-key dedupe. Standard
  and correct for "never emit an unsolvable board." ✔
- The **only** algorithmic efficiency lever is H2 (allocation, not asymptotics). The search
  structures themselves are appropriate; don't rewrite them — make their per-node cost cheaper.
- `is_stuck_in_loop` / `bfs_optimal` allocate `Vec<State>` frontiers of cloned states; these ride
  on the same H2 fix (cheap `State` clone) for free.

## Suggested sequencing

1. **H2 measurement first** — add/confirm a generation benchmark baseline (the `benchmark` skill /
   `npm run bench`), then land the `SmallVec` changes and show the delta. Highest user-visible payoff
   (live-gen/bake speed), lowest behavioral risk given the golden vectors.
2. **H1 + M1 together** — extract the hint/auto-solve controllers and unify the install paths in one
   focused refactor of `gameStore.ts`, leaning on the existing store tests.
3. **M3 / M4** — mechanical cleanups, do anytime.
4. **M2 / L\*** — only if profiling or further growth justifies them.

## Scope note

This review covers architecture, SOLID, algorithms, and code quality. It is **not** a security or
dependency-audit pass, and it did not re-run the full gate as part of writing (no code was changed).
Every recommendation above is behavior-preserving and should be validated through the existing gate
(`npm run check`) and, for H2, the golden vectors + benchmark.
