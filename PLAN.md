# Plan

This file carries **open work only**. Shipped work is condensed to one-line pointers in
[DONE.md](DONE.md); the full design rationale and as-built notes live in the memory notes, the README
"Architecture" section, and git history.

Baseline: lint / tsc / tests green; the engine/solver/generator split, derived-overlay design, and
registry are healthy. The work below is **growth and polish**, not debt.

---

# Next steps

**Track F (native + WASM core port) is the current priority** (decided 2026-07-01): rewrite the pure
level-generation/evaluation core in Rust, compiled to a **native arm64 CLI** for the offline bake and a
**`.wasm`** worker for the deployed app (solving *and* live generation), so the generate→evaluate loop is
fast enough for the many-more iterations, 1000+-level runs, and extra mechanics that JS can't reach (the
solver's inner loop is string-keyed today — `Set<string>` + `stateKey` serialization — which dominates
bake time). Full plan + phases in the **Track F** section below. The JS app stays fully live until parity;
cutover is a one-time re-bake. **Track E's remaining items are absorbed into F**: E5 (slice-bake) becomes
a flag on the Rust bake (F2), E7 (solvability gate) becomes the cross-language JS validation gate (F4),
E8/E9 fold in or de-scope (F5).

**Track E (debug & authoring tools) — E1–E4 + E6 SHIPPED** (inspector, report/diff CLI + interactive
report app with build-history comparison, admin navigation, solver cheats, curve viz; see
[DONE.md](DONE.md)). These directly support the port — the build-history report is how the Rust re-bake
gets vetted against the JS bake.

**Track D (chapter 5 / new mechanic) stays DEFERRED** (decided 2026-06-23) — design kept on file below,
not scheduled. Picking it back up means resolving the D1-vs-D2 fork first, then following the steps.
**Post-port, D2 (the turn-cadence "rhythm" mechanic) gets dramatically cheaper** — its phase-aware solver
+ rejection sampling is exactly the kind of heavy search the native core makes affordable.

The non-negotiable invariant for anything touching boards: a mechanic is a **static, color-keyed,
position-independent overlay derived from the stored solution** — never an engine change, always
solvable by construction, always shuffle/recolor-safe. Track D lives or dies by this; Track E and the
Track F port preserve it (the Rust core reimplements the same derived-overlay rules, validated against JS).

---

## F′. Track F post-completion code review  (ACTIVE 2026-07-05 — SOLID / best-practice cleanup)

> Track F shipped F0–F6 (see below). A review of the landed Rust core + wasm boundary + JS adapter for
> SOLID/DRY/idioms surfaced the items below. Correctness is solid (full gate + 325 tests); these are
> **quality** fixes. **ALL PHASES COMPLETE 2026-07-05** — gate PASS + 325 tests + 0 clippy warnings after
> each; bake byte-identical throughout (pure refactors). `[x]` = done.
>
> **Phase 1 — idiom (clippy), zero risk. `[x]`** The 6 lib warnings fixed: `generator.rs`
> (`!(2..=MAX).contains` + `bottles > colors`), `hidden.rs`/`ice.rs` (`is_empty()`), `ice.rs`
> (iterate `drop_time[b]` by value), `session.rs` (`.zip(blocked).enumerate()`). Clippy now clean
> across all targets.
>
> **Phase 2 — DRY palette codec. `[x]` R-1**: added `types::color_name(u8)` / `types::color_index(&str)
> -> Option<u8>`; `bin/verify.rs` + `bin/bake.rs` now delegate (deleted their local `color_name` and the
> inline `position`). JS keeps its own (cross-language) `colorIndex` with the palette-order contract note.
>
> **Phase 3 — SOLID boundary: a `Board` handle. `[x]` R-2**: replaced the four `#[wasm_bindgen]` fns
> (`hint`/`board_view`/`tap`/`cheat_force_pour`) — each with `#[allow(too_many_arguments)]` and the
> repeated 6-arg board prefix — with a `#[wasm_bindgen] Board` opaque handle: constructor decodes once,
> methods `hint`/`view`/`tap`/`force_pour` are cohesive and short. All four `too_many_arguments` allows on
> those are gone. JS got one `withBoard(state,hidden,overlays, fn)` helper (encode → `new Board` → run →
> `free()`), collapsing the three repeated encode prefixes. `stuck_*` stayed free (global registry, short
> sigs). *`generate_live` kept its single `#[allow(too_many_arguments)]`: it's one generation entry point
> with no shared prefix, and a `LiveParams` wasm struct would just relocate the arg list to a data
> constructor — net churn for no cohesion gain, so accepted.*
>
> **Phase 4 — JS decode DRY. `[x]` J-1**: extracted `decodeCells(cells,bottles,capacity)` + a
> bottles-based `masksToGrid`; `wasmPickBest`, `decodeTapPour`, and `wasmBoardView` all reuse them (was
> three inline copies of the NO_COLOR-break loop and the mask→grid map).
>
> **Accepted / won't-fix (documented, not changed):** **R-3** `wasm.rs` is one module mixing
> smoke/stuck/session(Board)/live — splitting is cosmetic under wasm-bindgen (exports must be in the
> crate); the `Board` handle already improved cohesion. **R-5** `LiveLevel`'s flat `m_*` metric fields are
> FFI-forced (wasm-bindgen structs don't nest); the grouping lives in JS `WasmLivePick`. **R-4** the
> mechanics-mask bits (1/2/4) are mirrored in Rust `generate_live` + JS `wasmPickBest` — genuinely
> cross-language, so not dedupable beyond a shared comment.

---

## F. Native + WASM core port  (ACTIVE — top priority; supersedes E5 and the JS hot-loop watch-list)

> Decided 2026-07-01. Port the pure level-generation/evaluation core (engine rules, the three mechanics,
> solver/search, generator, difficulty scoring) from TypeScript to **one Rust crate**, compiled to **two
> targets**: a native arm64 CLI (offline bake) and a `.wasm` module (in-browser worker). The solver hot
> loop is string-keyed today (`Set<string>` visited/frontier + `stateKey` board serialization); packed
> integer state in compiled code removes that entirely — most of the win is JS→packed, native/threads add
> more on top. This does **not** touch the static-overlay board invariant; the Rust core reimplements the
> same rules and is validated against the JS core.

### Fixed decisions (planning 2026-07-01)
- **One crate, two targets.** `cargo build --release` → native bake CLI; `wasm-pack build` → the worker
  `.wasm`. Shared core logic; only platform slivers differ (`#[cfg(target_arch = "wasm32")]`: threads, IO).
- **Runtime uses the core for solving *and* live generation.** Hints, auto-solve, stuck-detection, and
  endless/daily/tail generation call the WASM worker (off the main thread — same seam as today's
  `hintWorker`). **JS keeps** the gameplay engine ops (`pour`/`isWon`/`legalMoves`), the mechanic
  *interaction* reads (`blockedColumns`/`acceptsPour`/`blocksCompletion`), baked-level load/deserialize,
  display shuffle/recolor, the store, and all UI — **through cutover**. The adopted end-state
  (decided 2026-07-04) is **F6**: once the core is trusted, the gameplay rules move behind the WASM
  boundary too, so the rules live in exactly ONE place and the drift gate can largely retire.
- **Cutover accepts new levels.** A Rust bake won't reproduce today's 240 boards byte-for-byte (different
  RNG consumption, float scoring, hash-iteration order). Cutover swaps in freshly-validated boards.
  Progress/stars are keyed by level *number*, so saves are unaffected (a player mid-board sees a new board
  next load; the daily changes for that date — acceptable).
  **OVERTAKEN BY RESULTS 2026-07-04: the insurance wasn't needed.** The Rust bake reproduces the committed
  JS bake **byte-identically** — all 240 boards, overlays, optimal/twoStarMax/par/phase (draw-for-draw rng
  + exact-order float parity ran the table; the `pow` ulps in `targetPercentile` never flipped a pick). So
  F4's cutover can ship the *identical* campaign: no board churn, no mid-level surprises, no daily change.
- **Bake local, CI Rust-free.** Bake on the dev Mac (arm64), commit `levels.data.ts` + provenance. The
  `.wasm` is likewise a **committed build artifact** (web build/deploy needs no Rust), guarded by a
  source-hash test (like `levelVersion.ts`) that fails if the crate changed without a rebuild. CI runs
  only the JS validation gate (F4).
- **JS core stays as the oracle.** The TS solver/generator remains in-tree through migration for
  differential testing and as a feature-flagged fallback; deleted only at final cleanup (F5).
- **Parity target = today's 4 chapters / 240 levels.** Scaling to 1000+ levels and new mechanics is a
  cheap follow-on once the core lands (not part of this plan).

### Port surface (mapped from the current code)
Hot logic to port (~2–2.5k lines of pure TS): `engine.ts` rules · `hidden.ts`/`funnels.ts`/`ice.ts` +
the `mechanics.ts` registry (both the build-from-solution side and the solver-aware blocking/accepts/
frozen-cells side) · `search.ts` (A* `optimalCappedMoves`, tier sweep `nearOptimalCutoffs`, `hintMove`,
`stateKey`) · `solver.ts` (DFS `search`/`isUnsolvable`/`isStuckInLoop`, `bfsOptimal`) · `generator.ts`
(rejection sampling) · `difficulty.ts` (`measureMetrics` + `compositeScores` + `assignSlots`) ·
`progression.ts` shapes/curve/density/seeds · `rng.ts` (mulberry32, trivial to match). The confirmed
runtime call-sites that will target the WASM worker: `hintMove` (hints + auto-solve in `gameStore`),
`isStuckInLoop` (`session.ts`), and `pickBest`/`generateDailyLevel` live gen (`levelLoader.ts`).

### Phases (JS stays fully live until F4)
- **F0 — Scaffolding. ✅ DONE 2026-07-03.** Rust workspace + `core/` crate; both targets build (native
  `bake` stub via `npm run core:build`, 14 kB wasm via `npm run core:wasm`; wasm-pack 0.15 installed via
  brew). Byte-boundary types in `core/src/types.rs` (flat `u8` cells, `NO_COLOR=255` sentinel, bottle-major
  bottom-first; funnels per-tube / ice+hidden per-cell). `rng.ts` ported bit-exact and the **G1 vector
  infrastructure stood up early**: `scripts/emit-vectors.ts` (JS oracle) → `vectors/rng.json` → asserted by
  both `rng.vectors.test.ts` (vitest) and `core/tests/rng_vectors.rs` (cargo), plus a Node smoke test
  proving the wasm module loads and matches. **Gotcha for future vectors: store integers, never floats** —
  serde_json's default float parse is off by 1 ulp (correct rounding is the opt-in `float_roundtrip`
  feature), so rng draws are stored as raw u32. Vite wasm wiring deferred to F3 (nothing imports the wasm
  until the runtime adapters exist). Toolchain note: the `~/.cargo/bin` rustup shims were broken symlinks
  (rustup moved to Homebrew); relinked to `/opt/homebrew/opt/rustup/libexec/bin/rustup`.
- **F1 — Core rules + solver, differential-tested.** Port engine + mechanics + search + generator + rng.
  Stand up the **`exe/test` gate's first checks** (G1 shared vectors + G2 Rust→JS conformance trace, see
  below): the Rust core emits a trace of visited states + move-sets + transitions, JS validates it. Gate:
  100% agreement. *No app change.*
  **STATUS 2026-07-04 — port complete, conformance green.** All of engine/hidden/funnels/ice/solver/
  search/generator ported (`core/src/*`), packed state (nibble-packed `u64` tubes, `u16` hidden masks,
  sorted-`u128` canonical keys — equivalence classes identical to JS `stateKey`). `vectors/solver.json`
  (10 seeded cases spanning every SHAPES family + all three mechanics + minPar/parMode paths) replays
  **exactly** in both `core/tests/conformance.rs` and the JS pinning test `solver.vectors.test.ts`:
  identical boards, DFS solutions, overlays, capped-search results — including budget-exhaustion `null`s
  and hint tie-breaking (the JS `MinHeap` is structurally replicated). Release-mode core runs the vector
  workload ~5× faster than JS before any tuning. **Remaining for F1:** the full G2 harness (Rust emits a
  bounded trace over the *committed* boards + a seeded random corpus; JS validates) — needs the baked-data
  read path, so it lands alongside F2's serialize/deserialize work.
- **F2 — Native bake, compared not committed.** Port difficulty (metrics + scoring + slot assignment) +
  progression + the parallel bake (rayon across all cores). The `bake` binary writes to a **scratch path**
  + provenance JSON — never the committed data yet.
  **STATUS 2026-07-04 — core of F2 shipped.** `difficulty.rs`/`progression.rs`/`mechanics.rs` ported and
  **bit-exactly conformant** (`vectors/difficulty.json`: metrics, composite scores, and slot picks pinned
  as f64-bit strings; `seedForLevel` exact; `targetPercentile` tolerance-compared — it goes through `pow`,
  handled deterministically cross-target via `libm`). The `bake` binary runs the full pipeline (rayon over
  (chapter, shape) jobs, same seeding scheme as the JS worker) with `--chapter N`/`--level N` slice flags
  (**E5 delivered**) and emits `levels.json` (BakedLevel-shaped) + `provenance.json` (report-app shape) +
  `golden-lines.json` (per-level optimal winning line via `optimal_capped_line`). **Full 240-level bake at
  identical quality settings: 108.7s** vs the JS bake's ~8–10 min (~5×). **First G3+G4 run is green**:
  `scripts/verify-bake.ts` validates a bake dir under the JS runtime rules — all 240 levels pass the
  static checks and all 203 exact-optimal golden lines replay in JS at *exactly* `optimal` (37 proxy
  levels skipped by design).
  **F2 COMPLETE 2026-07-04 (+ the F1-leftover G2):** `archive-report.ts --from` archives a Rust
  provenance (version = crate-source FNV hash, e.g. `rust-37d2b49699957cf7`) into `scripts/build-history/`
  and the report app's pickers/Builds table diff it against the committed bake with zero extra wiring
  (verified in-browser: Δmean +0.000). **G2 shipped**: the `trace` binary emits a bounded conformance
  trace (golden-line states + seeded offshoots + a 20-board random corpus — 260 traces, ~6.7k states) and
  `scripts/verify-trace.ts` replays it under JS rules using ONLY the public primitives that survive F5
  (no `search.ts`/`solver.ts` imports — G2 outlives the deletion): all states move-set-equal, all 6,461
  transitions exact, in ~0.4s. **`exe/test` now exists and passes G1–G4 end-to-end** (G5 lands with F3's
  committed-wasm hash guard). And the headline: **the Rust bake reproduces the committed JS bake
  byte-identically** (all 240 boards + overlays + star data — see the fixed-decisions note). **Emission path (decided):** the Rust binary emits
  JSON only (boards + provenance); a small JS emitter turns that into `levels.data.ts`, reusing the
  existing `emit-provenance.ts`/`archive-report.ts` post-bake wiring — Rust never writes TS directly.
  (This JSON↔TS seam is also where G4's Rust-written ↔ JS-read round-trip test lives.) Archive that provenance and **diff it against the
  committed JS bake in the report app's build-history view** to vet the new curve. The bake also emits a
  **golden optimal winning-line per level** (feeds gate G3). Absorbs **E5**: the `--level N`/`--chapter N`
  slice fast-path is now trivial + near-instant. *Still no app change.*
- **F3 — WASM + runtime adapters behind a flag.** `wasm-pack` build; commit the `.wasm` (+ hash-guard
  test). Wire the runtime seams to the WASM worker **behind an admin/settings flag** (the hidden hatch),
  default OFF: hint worker, auto-solve, stuck-detection, live gen. Both paths coexist → A/B on-device.
  Differential-test live-gen (JS vs WASM) for solvability + metric agreement + daily determinism. **Design
  point:** `isStuckInLoop`'s store-side visited `Set<string>` either stays a thin JS check or its keys
  cross the boundary — decide here. Note this decision sets F5's deletion list: if it stays JS, then
  `isStuckInLoop` and its `canonical`/`stateKey` dependencies join the retained gameplay set and can't be
  deleted with the rest of the JS solver. **With F6 adopted, prefer moving it fully into WASM** (visited
  keys computed and held core-side), so F5/F6 can delete `stateKey`/`canonical` from JS entirely.
  **STATUS 2026-07-04 — solver seams SHIPPED; live gen remaining.** The committed wasm package lives at
  `src/game/core-pkg/` (47 kB, built by `npm run core:wasm`, which also stamps the crate-source hash);
  **G5 is live** (`coreVersion.test.ts` fails if `core/` changes without a rebuild) and wired into
  `exe/test` — the full G1–G5 gate passes. Adapter: `coreWasm.ts` (id↔index conversion, `wasmHintMove`,
  `wasmStuck`) + `coreHintWorker.ts` (twin of `hintWorker.ts`, same message contract). Admin-hatch
  **"WASM Core" toggle** (persisted `wasmCore`, default OFF): hint + auto-solve pick the wasm worker
  (swap needs no reload), and **stuck detection resolved per the F6 note** — visited keys live in a
  core-side registry (`stuck_reset`/`visit`/`check`; the JS Set stays as parallel fallback, so the flag
  can flip mid-attempt; an under-populated registry can only under-fire). `deriveStatus` takes an
  injected `stuckCheck`. Differential adapter tests load the real committed `.wasm` in vitest (hint
  agreement incl. tie-breaks, registry-vs-Set agreement). **Verified in-browser**: flag on → wasm fetched
  on the main thread, hint computed by `coreHintWorker`, pour committed through the wasm stuck path, no
  console errors.
  **F3 COMPLETE 2026-07-04 — live gen shipped too.** The whole coarse-to-fine `pickBest` loop is ported
  (`core/src/live.rs` + the `generate_live` wasm export): plan/target/budget are INPUTS (so `pow` never
  runs core-side and `LiveGenConfig` stays JS-tunable), and `levelLoader.pickBest` routes through
  `wasmPickBest` when active (`setLiveCoreEnabled` injected from the store — `game/` never imports
  `store/`), JS path as fallback. **The live-gen differential is green and exact**: daily and random
  boards are IDENTICAL on both cores — boards, overlays, star data, provenance (`coreLive.test.ts`,
  wired into the gate's G5 leg). Daily cross-device determinism now rests on fixed-order arithmetic
  rather than JS float luck. Minimal E9 slice: the Settings admin hint shows the active core + wasm
  version (full diagnostics readout stays an F5 item). Committed wasm is 104 kB. What F4 needs now:
  flip the flag default, re-bake→commit via the Rust bake (byte-identical, so a no-op for players),
  keep the JS core as the flagged fallback for one release.
- **F4 — Cutover.** Native bake → overwrite committed `levels.data.ts` with the accepted new levels;
  archive its provenance as the new baseline. Flip the runtime flag default to WASM. The full **`exe/test`
  gate (G1–G5) must pass** before deploying. Keep the JS core as a flagged fallback for one release.
  **F4 COMPLETE 2026-07-04.** The committed data now flows through the Rust pipeline:
  `npm run build:levels` shells the native bake (`bake --out bake-out` → `emit-baked-from-rust.ts` →
  the existing provenance/archive steps; ~2 min vs the JS bake's 8–10, which stays as
  `build:levels:js` for one release). Cutover was a **player no-op as predicted**: boards byte-match
  (the emitter asserts and prints it), provenance JSON zero-diff (after fixing `serde_json::json!`'s
  alphabetized key order with a typed wrapper), only the generated-by headers changed. **Flag default
  flipped ON** (fresh installs AND legacy saves; explicit admin toggles respected; jsdom tests keep the
  JS path via the `typeof Worker` sentinel). Interim version-stamp policy documented in the emitter:
  committed data keeps the JS-source hash until F5 repoints it at the crate; G5 covers crate↔wasm
  freshness meanwhile. **Go/no-go ran green**: full G1–G5 gate against the cutover bake, 333 tests,
  lint/tsc, production build (wasm as hashed precached asset — offline intact), and a fresh-user
  browser boot loads the wasm core with a clean console.
- **F5 — Cleanup / parity confirmed.** After a confident release, delete the dead JS solver/search/
  generator/difficulty (keep gameplay engine + mechanic interaction — **until F6 takes those too**;
  optionally keep a slim oracle in tests). Point the staleness hash at the Rust crate. The JS hot-loop
  **watch-list items become WON'T-FIX** (superseded). **E8** golden-snapshot is optional (build-history +
  the hash guards cover most drift). **E9** diagnostics readout absorbs the F3 core-toggle (show core:
  wasm/js, last solve timing, baked vs live). Update docs/memory.
  **F5 COMPLETE 2026-07-05.** The JS core is out of the RUNTIME GRAPH — `hintWorker.ts` and the JS bake
  scripts deleted; `solver/search/generator/difficulty.ts` **demoted to test-only oracles** (the "slim
  oracle" option: the mechanic suites generate fixtures with them, `coreWasm.test.ts` uses them as the
  differential reference, `emit-vectors.ts` as the frozen-vector oracle), enforced by an ESLint
  `no-restricted-imports` guard — which caught a real leak on its first run. Bundle proof: main chunk
  369.9 → 357.9 kB, one worker. Store/session carry zero rule-search state: the `visited` Set and
  `canonical` are gone (registry is core-side), `deriveStatus` takes only the injected `stuckCheck`,
  hint fallbacks are sync main-thread wasm, `levelLoader` awaits core init at module load (test setup
  byte-inits first) and the live path is wasm-only. **The A/B flag was removed with the JS core it
  toggled** (F4's "one release" fallback superseded by doing F5 immediately — Markus's call). Staleness
  hash REPOINTED AT THE CRATE: `levelVersion` delegates to `coreVersion`, so ONE crate hash stamps both
  committed artifacts (`levels.meta.ts` re-stamped `874caec0a6f9133f`, provenance re-archived as the new
  baseline). **E9 shipped**: Settings admin shows core+version, last load (board/source/ms), cache sizes,
  live budget. Runtime homes extracted: `palette.ts` (PALETTE/DEFAULT_CAPACITY), `provenance.ts`
  (`Metrics`), `coreWasm.ts` (`HintMove`/`HintRequest`). Boundary made fail-soft for admin-injected
  non-palette boards (hint/stuck degrade to "no verdict" instead of throwing). Full gate + 326 tests +
  prod build + fresh-boot browser check all green.
- **F6 — Gameplay rules into WASM; retire the drift gate.** (Adopted 2026-07-04; run only after F4/F5
  prove the core.) Move the LAST rule-bearing JS — the gameplay engine ops and the mechanic interaction
  reads — behind the WASM boundary, so the rules live in exactly one place and the dual-implementation
  drift hazard is gone *structurally*, not just gated. Shape (details TBD at implementation): the store
  makes **one synchronous call per player action** (WASM instantiates on the main thread too — calls are
  sync, taps stay instant; the worker copy remains for search) and gets back a **view snapshot** — next
  state + revealed cells + frozen masks + capped tubes + won/stuck/legal-move info — which the UI renders;
  JS keeps zero rule semantics. Includes: `isStuckInLoop` fully core-side (per the F3 note), the
  `forcePour` cheat via a core entry point, vitest loading the wasm for store tests (proven: `initSync`
  works under Node), and a candidate simplification — recolor as a render-time id→display mapping instead
  of state mutation, shrinking the boundary further. **Payoff: G1/G2 retire** (nothing left to drift);
  the release gate shrinks to G3-style replay of committed data + G4 static checks + G5 freshness. Then
  delete `engine.ts`, `hidden.ts`/`funnels.ts`/`ice.ts` interaction reads, and `stateKey`/`canonical`.
  **STATUS 2026-07-05 — the session surface is LIVE; deletion + gate retirement remain.**
  `core/src/session.rs` (+ wasm exports `board_view`/`tap`/`cheat_force_pour`) now answers every
  runtime rule question: `session.ts` is a thin typed adapter (`deriveStatus`/`viewOf`/`planTap` are
  core pass-throughs; `cueForTap` classifies from core-supplied facts — the pour outcome carries
  `thawed`/`newlyCapped`), `GameBoard`/`Bottle` render from the `viewOf` snapshot (frozen cells, capped
  tubes, pour-target highlights — the stuck check is skipped on render-path views), and the free-pour
  cheat runs core-side. **Zero VALUE imports of engine/hidden/funnels/ice/mechanics remain outside
  `src/game/` internals — only erased type imports.** Test fixtures canonicalize shorthand ids to real
  palette ids (the boundary encodes palette indices); the one non-palette-trigger test trick was
  reworked via `undo`. Verified: 325 tests, gate G1–G5 PASS, prod build, in-browser pour/select/
  target-highlight through the core with a clean console.
  **F6 COMPLETE 2026-07-05 — the drift gate is retired; TRACK F IS DONE.** `mechanics.ts` trimmed to
  the DISPLAY half only (a slim `{get,put,empty,permute,recolor,deserialize}` registry driving
  `emptyOverlays`/`permuteOverlays`/`recolorOverlays`/`deserializeOverlays`); the interaction methods +
  `blockedColumns`/`acceptsPour`/`blocksCompletion` + the build/serialize/presence/static machinery are
  gone (zero callers). **G2 RETIRED** (no second implementation to trace against): deleted the `trace`
  bin + `verify-trace.ts`. **G3/G4 went native**: `core/src/bin/verify.rs` replays each committed golden
  line through the core's own `plan_tap` (win at exactly `optimal`) + static checks (degenerate/presence/
  bounds/round-trip/dedupe), replacing `verify-bake.ts` — same coverage (240 levels, 203 lines, 37 proxy
  skipped), now a core self-check. `exe/test` shrunk to **G1 (vectors) + G3/G4 (core verify) + G5
  (freshness + differentials)**. Main bundle 361.8 → 356.1 kB. The mechanic modules keep their compute/
  rule fns as test-only oracles (their OverlaySet transforms — `recolorFunnels`/`recolorIce`/grid
  shapers — stay runtime). Verified: full gate PASS, 325 tests, lint/tsc, prod build, in-browser
  ice-chapter board rendering 6 frozen cells from the core `viewOf`.

### Drift defense — the `exe/test` release gate
> **RESOLVED at F6 (2026-07-05): the drift hazard is gone — the rules live in exactly ONE place (the
> Rust core), so there is no second implementation to drift from.** The gate below served F1→F6 while
> both the core and the JS engine held rules; the cross-language legs (**G2** Rust→JS trace, and the
> JS-replay of **G3/G4**) retired with the JS engine. What survives is regression coverage, not drift
> defense: **G1** vector conformance (rng + solver/difficulty vectors pin the core against its own
> regressions), **G3/G4** as a native `verify` self-check of the committed artifacts, and **G5**
> artifact freshness. The historical design is kept below for context.
>
> The one hazard *was* **rule drift**: after cutover the same rules lived in both the Rust core and the
> JS gameplay engine, and a later edit to one side could silently diverge — a WASM-generated board
> unsolvable, or a committed `optimal` unreachable, under JS rules.

**Strategy: Rust generates the evidence, JS validates it cheaply.** The Rust solver already explores a huge
reachable graph per solve, so it emits bounded artifacts that JS checks in O(moves) with **no JS search and
no wasm-in-loop** — which is what keeps the gate fast enough to run on the Mac before every deploy. No CI
required (CI isn't set up and is *not* a hard requirement); one script is the go/no-go.

**`exe/test` — the single release gate** (prints PASS/FAIL per check + overall verdict, nonzero exit on
fail). Runs in seconds; can be a `pre-push` git hook or run by hand. Built incrementally across F1–F4 —
**stand up each check as its inputs land, don't wait for the end** — and a *green `exe/test` is the
definition of "the port is finished"* (F4/F5):
- **G1 — Shared-vector conformance.** The engine/mechanic rules have ONE home: language-neutral JSON
  vectors (`{board, move} → {nextState, legalMoves, won}` + overlay cases — funnel rejects a tint, frozen
  cell blocks a run, hidden keeps a tube unfinished). Both the JS engine and the Rust core run the same
  vectors. A rule change means editing the vectors, forcing both sides to move together. *(from F1)*
- **G2 — Rust→JS conformance trace.** Rust emits a bounded trace (visited states + their legal/useful move
  sets + each move's resulting state) from solves of all committed boards + a seeded random corpus.
  **Bound (decided):** per level, the full optimal line plus a seeded random sample of ≤200 other visited
  states — never the full visited set (a hard board's search visits millions of nodes; replaying all of
  them would break the runs-in-seconds budget the gate design rests on). JS replays every entry: each move legal under JS rules, move-set **set-equal** to Rust's, next-state
  **exactly** equal. Move-set equality catches drift in *both* directions (a move Rust sees and JS doesn't
  → its solution would be illegal in JS; a move Rust pruned that JS keeps → its optimal could be wrong).
  This is what replaces slow independent JS re-solving. *(from F1)*
- **G3 — Golden winning-line replay.** Per committed level, JS replays Rust's emitted optimal line and
  asserts a win at exactly `optimal`. Proves 3★ is *achievable under JS rules* per level — kills the
  catastrophic "committed optimal unreachable in JS" case instantly, no search. *(from F2)*
- **G4 — Committed-level static checks.** No degenerate boards, required mechanics present, `par ≥ optimal`,
  `twoStarMax > optimal`, and a serialize↔deserialize round-trip (Rust-written data ↔ JS-read). *(from F2/F4)*
- **G5 — Artifact freshness.** Crate-source hash matches the committed `.wasm` and the `levels.data.ts`
  stamp (can't ship a stale artifact against changed rules), and shared constants (palette, capacity,
  SHAPES, curve, density, MECHANIC_ORDER, XOR seeds) match across languages. *(from F3/F4)*

**Deliberately NOT in the gate** (keeps it fast; G2+G3 already pin the runtime-critical properties): a full
independent JS re-solve of all committed boards for exact-optimal equality → an **optional manual**
`exe/verify-optimal`, run only when you actually change a rule. Likewise an **optional manual** `exe/fuzz`
(seeded divergence hunt) — no scheduled/nightly anything (one-person project, no CI budget).

**Runtime belt-and-suspenders** (live-gen only, since baked boards are gate-covered): before handing a
WASM-generated board to the player, a cheap JS check (not already won, not degenerate, WASM's first hint is
JS-legal); on failure, fall back to the JS generator / re-roll. Near-free while the JS core is still in-tree.

### Risks / open design points
- **Rule drift JS↔Rust** — the one real hazard (a WASM board unsolvable/mis-rated under JS rules), addressed
  by the `exe/test` gate above; the JS engine ops stay authoritative for gameplay and are asserted against
  the core via G1/G2.
- **Determinism** — integer state ⇒ native and wasm agree bit-for-bit; keep scoring in `f64` without
  fast-math (Rust default) or fixed-point so cross-target / cross-arch bakes match. WASM float determinism
  actually *improves* daily cross-device identity vs today.
- **Bundle / instantiate** — commit the `.wasm` (tens–low-hundreds of KB, Brotli'd by Cloudflare, service-
  worker cached, works offline); instantiate once per worker; keep the client node-budget bounded (iOS
  memory) exactly as today. No `SharedArrayBuffer`/COOP-COEP needed (single-threaded on the client).

---

## D. Chapter 5 — new cumulative mechanic  (DEFERRED — forces a re-bake)

> **Parked 2026-06-23.** Not scheduled. The design below (the D1/D2 locking fork) is kept on file so the
> decision and rationale aren't lost — picking it back up means resolving the D1-vs-D2 question first,
> then following the implementation steps.

The registry (`mechanics.ts`) + `Overlays` bundle were built precisely so this is cheap: write the
overlay module, register it, add its data field to the few typed homes (`OverlaySet`, `BakedLevel`,
store, UI), add its density to `progression.ts`, bake. No new `*For` function, no positional-param
churn, no hand-written filter — the build/transform/serialize/filter/interaction logic is all
registry-driven (see `mechanic-registry` memo for the exact add-a-mechanic checklist).

### Theme: **locking tubes** — but DECISION PENDING on which kind

The desired feel (user, 2026-06-23) is *"tubes locking/unlocking — something blocking the opening every
2nd/3rd/4th turn."* That instinct splits into two mechanics with **very different costs**, because of a
hard property of this codebase: an overlay can only stay cheap (no search-state growth) and
free-to-make-solvable (derive from the stored solution) if its state is a **pure function of the board**.
A *rhythm based on turn count is not* — it's a clock. So:

> **The oscillation is the irreducible part.** Capping is permanent, so the set of completed colors only
> ever GROWS; therefore anything derived from the board can flip a tube lock→unlock **once and never
> back**. A tube that re-locks on a cadence genuinely needs a move counter — a time dimension the other
> three mechanics deliberately avoid.

#### Option D1 — **Progress-gated locks** (fits the blueprint; cheap; RECOMMENDED)

A whole tube starts **sealed** (no pour **in** or **out**) until a trigger color `C` is completed, then
unlocks for good. Color-keyed ⇒ shuffle/recolor-safe like ice's trigger. New axis vs. ice: ice freezes a
tube's *bottom region* (blocks extraction + capping); a sealed tube blocks **the entire tube including
receiving pours** — it removes a *workspace* until the key color lands, which ice never does. Reads
instantly: "locked tube — finish gold to open it," and chains into the same unlock-cascade ice has. This
captures *"tubes unlocking as you play"* — just gated on **progress** (colors completed), not a clock.

- **Derivation (free solvability, mirrors `ice.ts`):** seal tube `b` with trigger `C` iff `C` is
  completed in the stored solution **strictly before `b` is first used** (as source *or* destination).
  Replaying the solution always opens `b` in time ⇒ solvable by construction. No self-deadlock: the tube
  that caps `C` is, by construction, not `b`. Same force-one-eligible fallback + pool filter as ice.
- **No new search-state dimension.** "Completed ⟺ a capped tube of that color currently exists" is a pure
  function of the board, so `stateKey` does not grow — sealed/unsealed is recomputed per node like
  `frozenCells`.
- A milder variant if pure keyed feels too close to ice: gate on a **count** ("opens once N colors are
  done") instead of a specific color — still board-derived, monotonic, free to derive. Same machinery.

#### Option D2 — **Periodic / turn-cadence locks** (the literal idea; bigger project)

A tube's opening is blocked on a move-count rhythm (period 2/3/4), blinking locked↔open as you play. This
is the literal *"every 2nd/3rd/4th turn"* idea and it's a genuinely fun, distinct mechanic — but it is
**not a drop-in chapter**; it's an engine/solver extension, closer in scope to the original baked-levels
effort:

- **Search grows a phase dimension.** State becomes `(bottles, hidden, moveCount mod L)` where `L` =
  lcm of the periods on the board (≤12). Bounded (≤12× state space) but real — `stateKey`, A*
  (`optimalCappedMoves`), `bfsOptimal`, and the DFS all must thread the phase, and "useful move" pruning
  becomes phase-dependent.
- **Free solvability is forfeited.** The "derive the overlay from the solution and it's automatically
  winnable" trick breaks: the solution has a fixed move count, and there is **no wait/pass move** in
  water-sort (every turn is a pour), so a cadence can collide with a needed pour and there's no idling
  out of it. Generation must switch to **solver-verified rejection sampling under a cadence-aware
  solver** — build the phase-aware solver first, then generate-and-verify (lower yield, slower bake).
- **Extra semantics:** undo must restore the phase; decide whether the counter counts all pours or only
  pours involving that tube (recommend **all pours**, simplest to reason about and to display); decide
  whether a blocked tube blocks in, out, or both.
- **Restart-safety is fine** (the per-tube period array permutes on shuffle like `hidden`/`ice`; no color
  trigger so recolor is a no-op) — the cost is entirely in search + generation, not in restart.

**This is a real fork to resolve before any D code is written** (see the open question at the top of
this planning round). D1 is a ~1-chapter effort that re-bakes chapters 0–3 byte-identically; D2 is a
multi-step solver project. A reasonable middle path: **ship D1 as chapter 5 now**, and keep D2 on file as
a future "rhythm" chapter once there's appetite for the solver work.

**Also-rejected — directional / one-way tubes ("wind").** Adjacency/direction is *position-dependent*,
which fights the color-keyed, shuffle-safe overlay design (the constraint would have to be re-derived
after every shuffle). Not an overlay; a separate larger project if ever wanted.

> The implementation steps + tests below are written for **D1 (progress-gated locks)**, the recommended
> path. If D2 is chosen instead, this section gets rewritten around the phase-aware solver — most of the
> module/registry/UI wiring carries over, but steps 1, 5, 6 and the whole "free solvability" argument are
> replaced by the search-phase + rejection-sampling work.

### Implementation — D1 (follow the `ice.ts` blueprint + the registry checklist)
1. `src/game/locks.ts` (new) — `LockGrid` (per-tube trigger `Color | null`), `noLocks`/`anyLock`,
   `sealedTubes(state, locks)` (the completed-color fixpoint, reusing the cascade pattern from
   `frozenCells`), `lockEligibleTubes(state, solution)` (per-tube earliest-use vs. `completedAt`),
   `buildLocks`/`computeLocks` (seeded per-tube seal + force-one fallback, own XOR constant),
   `recolorLocks`, `lockLoad`. Pure, unit-tested in isolation.
2. Register it in `mechanics.ts` (`MECHANIC_MODULES` + `MECHANIC_ORDER`); its `blocking`/`accepts`/
   `incomplete` ops seal the tube in **and** out and block completion.
3. Typed homes: `Mechanic` union (`types.ts`); `OverlaySet` + `BakedLevel` field; store fields
   (`locks`/`initialLocks`) — though R3/R1 collapsed most interaction to registry helpers, so this is
   small; the UI field.
4. `progression.ts`: `MECHANIC_SETS[4] = ['hidden','funnel','ice','locks']`, the three density literals
   (signature/inherited/balanced), `campaignDensity`, `CHAPTER_LEN` math (`DEFINED_CHAPTERS`→5,
   `CAMPAIGN_LENGTH`→300, chapter 4 = levels 241–300). `chapters.ts`: add the name.
5. `levelVersion.ts` `SOURCES` += `locks.ts`. Bake filter: chapter-5 pool keeps only boards with a
   sealed tube (`filterPresence` already generic — just register the mechanic's presence check).
6. **Difficulty term** `lockLoad`, gated into `compositeScores` ONLY when the pool has locks (same
   gate as `funnelLoad`/`iceLoad`, so chapters 0–3 re-bake byte-identically — do not shift the
   denominator otherwise).
7. **Visuals** (`Bottle.tsx` + CSS): a padlock / sealed-cap treatment tinted with the trigger color
   (`--lock` var, same plumbing as `--funnel`/`--ice`), a satisfying unlock animation on trigger
   completion. **Pair with a non-hue cue** (padlock glyph) per track C — don't rely on tint alone.
8. **Bake + verify:** `npm run build:levels` (~8–10 min). Confirm chapters 0–3 reproduce
   **byte-identically** (only the version hash + the new all-null `locks` field change), `baked.test.ts`
   passes, and run the `benchmark` skill so the live tail stays within the spinner budget.

### Tests
Eligibility (earliest-use-vs-completion ordering, source **and** destination); `computeLocks` per-tube
seal + force-one + RNG-stream alignment; `sealedTubes` fixpoint incl. a multi-step cascade and a
no-cascade board; `recolorLocks` lockstep with the board map; **solvability** (the stored solution opens
every tube and wins) over many seeds/shapes; **monotonicity** (more/earlier seals ⇒ `lockLoad`/`optimal`
non-decreasing); chapters 0–3 unchanged when `locks` is absent. Store: restart recolor/shuffle keeps
lock triggers matched to liquid; pour **into** and **out of** a sealed tube both rejected; injected-board
lock reset (the `funnels-mechanic` memo gotcha — injected test boards must reset `locks`/`initialLocks`).

---

## E. Debug & authoring tools  (ACTIVE — pure tooling, no board-invariant or re-bake impact)

> Added 2026-06-26. None of this touches the static-overlay invariant or the bake output. Everything here
> is observability + reproducibility: turn "this level feels wrong" into a number, and give an agent
> tuning `SCORE_WEIGHTS` / `SHAPES` a tight, diff-able feedback loop instead of 240-line console dumps.

**The shared spine — importable provenance — is built (E1, shipped).** `scripts/levels.provenance.json` is
mirrored into a generated, tree-shakeable `src/game/levels.provenance.ts` (by `scripts/emit-provenance.ts`,
run after the bake in `build:levels`) and read via `game/provenance.ts` (`getProvenance(level)` /
`loadProvenance()`). It loads via an **on-demand dynamic import** (its own ~67 kB lazy chunk, fetched only
when an admin opens the inspector) — the earlier `import.meta.env.DEV` gate was **removed** (see the E4
design change); the admin hatch is the sole gate. The report sub-tracks (E2 report/diff, E6 curve viz +
build-history, E8 snapshot) read the same JSON / typed module.

### Priority order
1. ~~**E1 — Level Inspector overlay + importable provenance**~~ — **SHIPPED 2026-06-26** (see [DONE.md](DONE.md)).
2. ~~**E2 — Bake report / diff CLI**~~ — **SHIPPED 2026-06-26**, plus an **interactive React+Vite report app** (`report/`, also delivers E6) (see [DONE.md](DONE.md)).
3. ~~**E3 — Admin navigation, mode & seed controls**~~ — **SHIPPED 2026-06-26** (see [DONE.md](DONE.md)).
4. ~~**E4 — Solver / mechanic introspection**~~ — **SHIPPED 2026-06-26** (reveal-hidden, free-pour, auto-solve; force-terminal deferred) (see [DONE.md](DONE.md)).
5. **E5 — Single-level / single-chapter bake fast path** → **absorbed into Track F (F2)** as a flag on the native Rust bake.
6. ~~**E6 — Curve visualization**~~ — **SHIPPED 2026-06-26** as the React report app's metric curves (see [DONE.md](DONE.md)).
7. **E7 — On-device solvability & quality assertion pass** → **becomes the cross-language JS validation gate (Track F, F4)**.
8. **E8 — Golden curve snapshot regression test** (catch silent bake drift in review).
9. **E9 — Diagnostics readout + live-config toggle.** (DEV gating removed — the admin hatch is the sole gate now.)

---

### E1 — Level Inspector overlay + importable provenance  — SHIPPED 2026-06-26

Done — see [DONE.md](DONE.md). The dev-only inspector overlay + the importable-provenance spine
(`game/provenance.ts`, generated `levels.provenance.ts`, `scripts/emit-provenance.ts`) the rest of the
track reuses. A follow-up once E3/E4 land: have the inspector's source line link to a "reload / re-roll"
action, and (E4) a "reveal hidden" toggle that the panel can surface inline.

---

### E2 — Bake report / diff CLI  — SHIPPED 2026-06-26

Done — see [DONE.md](DONE.md). `scripts/level-report.ts` over the typed/tested `src/game/levelReport.ts`;
report + diff modes via `npm run levels:report`. Confirmed in the live bake: the per-chapter metric means
show each signature mechanic lighting up (digDepth ch1, funnelLoad ch2, iceLoad ch3) and the monotonicity
slips cluster at the chapter plateaus — exactly the read it was built to give. E6 (richer curve viz) can
extend the ASCII score histogram already in the report.

---

### E3 — Admin navigation, mode & seed controls  — SHIPPED 2026-06-26

Done — see [DONE.md](DONE.md). "Admin · Navigate" subsection in the Settings hatch: jump-to-level (live
tail included), Play-seed (deterministic random repro via new `loadRandom(seed)` store seam), Endless /
Daily buttons, and Reload (`reloadBoard` — re-rolls in endless, deterministic reload otherwise; drops the
live caches first). Store seams unit-tested (determinism, reload modes, live-tail load).

---

### E4 — Solver / mechanic introspection  — SHIPPED 2026-06-26

Done — see [DONE.md](DONE.md). Three cheats live in the inspector popover (so they're gated by the admin
`inspector` flag, not the build): **reveal hidden** (render-only override in GameBoard), **free pour**
(`forcePour` + a `tapBottle` branch — kept in the store since `engine.ts` is bake-hashed), **auto-solve**
(`autoSolve` store action). The cheat flags are ephemeral and clear when the inspector is disabled.

Auto-solve **steps** the optimal line every 0.5s (visible), solving each move **in the hint worker
off-thread** (so a slow board never freezes the page) with a 20M node budget + 60s per-move timeout, a
floating **"Solving…" spinner chip + Stop** (the `autoSolving` flag; `cancelAutoSolve`), and a transient
**stop notice** ("Solver timed out" / "No further moves", `autoSolveNotice`) if it can't finish. The win
is recorded **normally — not counted as a hint** (no 1★ cap). Any manual interaction / board change
cancels it (generation-guarded). Minimal `[auto-solve]` debug logging (info/warn summary; debug per-move).

> **Design change (per user, 2026-06-26): dropped `import.meta.env.DEV` gating entirely** — the hidden
> admin hatch is the *sole* gate for all debug tooling. Provenance now loads via an on-demand dynamic
> import (its own ~67 kB lazy chunk, fetched only when an admin opens the inspector) instead of being
> DCE'd from prod; the inspector's metrics show whenever the admin inspector is on, in any build.

**Force-terminal (win/stuck/deadlock) deferred:** auto-solve already exercises the win path, and
constructing a meaningful `stuck`/`deadlocked` board is high-effort / low-value. Revisit if needed.

---

### E5 — Single-level / single-chapter bake fast path

> **Absorbed into Track F (F2).** Don't build this as a standalone JS effort — the native Rust bake makes a
> full run near-instant and the `--level N` / `--chapter N` slice flag rides along for free. Original spec
> kept below for the requirements it captures.

`build:levels` re-bakes the whole campaign (~8–10 min). Add `--level N` / `--chapter N` flags that bake
just that slice and print full metrics, so an agent iterating on one mechanic isn't paying full wall time
per try. **Output is for inspection only — never commit a partial `levels.data.ts`** (guard: a partial
run writes to a scratch path / stdout, not the committed data module).

**Tests.** Arg parsing selects the right chapter/level subset; a single-chapter run produces the same
boards for those levels as the full bake (determinism).

---

### E6 — Curve visualization  — SHIPPED 2026-06-26

Done — delivered as the interactive React+Vite report app (`report/`, see [DONE.md](DONE.md)): every
metric (incl. `score` vs `targetPercentile`) as a curve across the campaign with chapter bands, a shared
hover crosshair, and a comparison overlay. Goes well past the originally-scoped ASCII sparkline. Future
extensions (the app makes them cheap): per-family filtering, brushing/zoom, a second-bake diff curve view.

**Build-report history + multi-build comparison — SHIPPED 2026-07-01** (see [DONE.md](DONE.md)). Each bake
is archived under `scripts/build-history/<generator-hash>.json` (`scripts/archive-report.ts`, wired into
`build:levels`; idempotent per hash), and the report app grew baseline/compare build pickers + a Builds
overview table (mean/exact/slips, Δmean vs. baseline) so a bake is judged an improvement against prior
committed builds at a glance. This is much of what E8 wanted (retained per-build data for regression), via
committed data rather than a vitest snapshot.

---

### E7 — On-device solvability & quality assertion pass

> **Re-scoped into Track F (F4) as the cross-language contract gate.** After the port, this is the check
> that keeps the Rust bake and the JS runtime honest — run in *JS* over the committed (Rust-baked) boards,
> in CI, so no Rust toolchain is needed there. Spec below still applies.

One command (`npm run levels:verify`) that re-validates every committed baked board under the *runtime*
rules: solvable under hidden+funnel+ice, `optimal` reproducible within budget, `par ≥ optimal`, no
degenerate boards (e.g. a tube already complete at start). Exits non-zero naming the offending level —
the pre-commit gate for a re-bake. Overlaps `baked.test.ts` but is a single fail-fast CLI an agent runs
before committing, not a spec suite.

---

### E8 — Golden curve snapshot regression test

A committed compact summary (per-level `score` + footprint + `mechanics`) that a vitest snapshot diffs
against. `levelVersion.ts`'s hash catches *config* drift, but not "an unrelated change silently perturbed
every board's score." The snapshot surfaces that in review. Regenerate intentionally on a real re-bake.

> **Partially covered by build-history (2026-07-01):** `scripts/build-history/<hash>.json` now retains
> every bake's per-level data for after-the-fact comparison in the report app. What E8 still adds that
> build-history does not: an **automated, in-CI vitest assertion** that fails the build on unexpected
> drift (build-history is a manual, opt-in diff). Scope E8 down to that fail-fast test.

---

### E9 — Diagnostics readout + live-config toggle — SHIPPED with F5 (2026-07-05)

> Readout live in the Settings admin section: active core + wasm build version, last board load
> (label / baked-vs-live / ms), live+daily cache sizes, and the active pool budget
> (`loadDiagnostics()` in `levelLoader.ts`). The `DEFAULT_LIVE_CONFIG ⇄ TEST_LIVE_CONFIG` toggle was
> dropped — the budget now displays inline and tuning it is a one-line code change passed straight
> through to the wasm core. Original spec below for reference.

- **Readout** in the admin section / extend the existing build/version footer: live-gen `liveCache` size,
  last `getLevel` timing, whether the current board is **baked vs live**, and the active `LiveGenConfig`.
- **Toggle `DEFAULT_LIVE_CONFIG` ⇄ `TEST_LIVE_CONFIG`** via `configureLiveGenerator` to feel the
  quality/latency tradeoff on a real device.

> **Gating resolved (per user, 2026-06-26) — no DEV gate.** The original plan here was to gate the cheats
> behind `import.meta.env.DEV` so they're unreachable in production. That was **reversed**: all DEV gating
> was removed and the hidden 7-tap admin hatch is now the *sole* gate for every debug tool (inspector,
> cheats, provenance). So this sub-track is just the diagnostics readout + live-config toggle above.

---

## Standing / iterative work (never "done")

- **Re-tune the curve.** Adjust `SCORE_WEIGHTS` / `CURVE` in `difficulty.ts` + `progression.ts` from
  real playtests, then re-bake. Track B's stats shipped (signal exists) and the feedback loop is now in
  place — use **`npm run levels:report`** (Track E2): snapshot the current `levels.provenance.json`, change
  weights, re-bake, then diff the two so each weight pass is measured per-level rather than by-feel.
- **Settle the funnel knobs.** The `funnelLoad` formula and per-board lock cap were left to settle by
  feel; revisit alongside playtest re-bakes.
- **Mechanic-density tuning.** The signature/inherited/balanced density literals (`progression.ts`) are
  tuned against how chapters *read*; revisit per chapter as new mechanics land.

## Watch-list — CLOSED as WON'T-FIX (F5, 2026-07-05)

> **Superseded by Track F, now formally closed.** These were micro-optimizations of the JS solver hot
> loop; that loop is a test-only oracle since F5 (the runtime searches in the Rust core), so its
> inefficiencies no longer matter. Kept below only as historical record until F6 deletes the oracle.

- `nearOptimalCutoffs` (`search.ts`) iterates `layer.values()` twice per depth and recomputes `isSolved`
  (re-runs the `frozenCells` fixpoint) per state per pass. Fold the solved-check into the single
  expansion loop. Ice-chapter-only, bake-hashed.
- `frozenCells` / `cappedColors` (`ice.ts`) recomputed per node in `cappedSuccessors` and again in
  `isSolved`. Acceptable per the cheap-fixpoint argument; revisit only if the `benchmark` skill shows the
  ice (or new chapter-5) live tail near the spinner budget. The new `sealedTubes` fixpoint has the same
  shape — write it the same way and it inherits the same (acceptable) cost.

## Re-baking

`npm run build:levels` (≈2 min — the native Rust bake since the F4 cutover: `bake --out bake-out` +
`emit-baked-from-rust.ts`; the retired JS bake stays available as `npm run build:levels:js` for one
release). Any change to a bake-relevant source bumps the `levelVersion.ts` hash; `baked.test.ts` fails
until you re-bake (interim until F5 repoints the hash at the crate — bake-relevant RULE changes now live
in `core/`, and G1 discipline keeps the JS twins in lockstep while they exist). Re-baking reproduces
earlier chapters byte-identically (seed-deterministic) — that byte-identity is the regression check for
every new-mechanic change. Single-slice fast paths: `bake --chapter N` / `--level N`.
