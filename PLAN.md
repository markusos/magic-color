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
  display shuffle/recolor, the store, and all UI.
- **Cutover accepts new levels.** A Rust bake won't reproduce today's 240 boards byte-for-byte (different
  RNG consumption, float scoring, hash-iteration order). Cutover swaps in freshly-validated boards.
  Progress/stars are keyed by level *number*, so saves are unaffected (a player mid-board sees a new board
  next load; the daily changes for that date — acceptable).
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
- **F0 — Scaffolding.** Add the Rust crate (`core/`) + cargo workspace, `wasm-pack`/`wasm-bindgen` + Vite
  wasm integration, npm wiring (`build:levels` shells the native binary). Define the byte-boundary types
  (board as flat bytes; overlays as flat arrays) both targets share. No behavior change.
- **F1 — Core rules + solver, differential-tested.** Port engine + mechanics + search + generator + rng.
  Stand up the **`exe/test` gate's first checks** (G1 shared vectors + G2 Rust→JS conformance trace, see
  below): the Rust core emits a trace of visited states + move-sets + transitions, JS validates it. Gate:
  100% agreement. *No app change.*
- **F2 — Native bake, compared not committed.** Port difficulty (metrics + scoring + slot assignment) +
  progression + the parallel bake (rayon across all cores). The `bake` binary writes to a **scratch path**
  + provenance JSON — never the committed data yet. Archive that provenance and **diff it against the
  committed JS bake in the report app's build-history view** to vet the new curve. The bake also emits a
  **golden optimal winning-line per level** (feeds gate G3). Absorbs **E5**: the `--level N`/`--chapter N`
  slice fast-path is now trivial + near-instant. *Still no app change.*
- **F3 — WASM + runtime adapters behind a flag.** `wasm-pack` build; commit the `.wasm` (+ hash-guard
  test). Wire the runtime seams to the WASM worker **behind an admin/settings flag** (the hidden hatch),
  default OFF: hint worker, auto-solve, stuck-detection, live gen. Both paths coexist → A/B on-device.
  Differential-test live-gen (JS vs WASM) for solvability + metric agreement + daily determinism. **Design
  point:** `isStuckInLoop`'s store-side visited `Set<string>` either stays a thin JS check or its keys
  cross the boundary — decide here.
- **F4 — Cutover.** Native bake → overwrite committed `levels.data.ts` with the accepted new levels;
  archive its provenance as the new baseline. Flip the runtime flag default to WASM. The full **`exe/test`
  gate (G1–G5) must pass** before deploying. Keep the JS core as a flagged fallback for one release.
- **F5 — Cleanup / parity confirmed.** After a confident release, delete the dead JS solver/search/
  generator/difficulty (keep gameplay engine + mechanic interaction; optionally keep a slim oracle in
  tests). Point the staleness hash at the Rust crate. The JS hot-loop **watch-list items become WON'T-FIX**
  (superseded). **E8** golden-snapshot is optional (build-history + the hash guards cover most drift).
  **E9** diagnostics readout absorbs the F3 core-toggle (show core: wasm/js, last solve timing, baked vs
  live). Update docs/memory.

### Drift defense — the `exe/test` release gate
> The one real hazard is **rule drift**: after cutover the same rules live in both the Rust core (solving +
> generation) and the JS gameplay engine, and a later edit to one side could silently diverge — a
> WASM-generated board unsolvable, or a committed `optimal` unreachable, under JS rules. **Initial** drift
> (port bug) is easy; **regression** drift (a months-later edit) is the danger, so the defense is a
> permanent local gate, not a one-time harness.

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
  sets + each move's resulting state) from solves of all committed boards + a seeded random corpus. JS
  replays every entry: each move legal under JS rules, move-set **set-equal** to Rust's, next-state
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

### E9 — Diagnostics readout + live-config toggle

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

## Watch-list (bundle into the next re-bake, don't touch the hot loop alone)

> **Superseded by Track F.** These are micro-optimizations of the JS solver hot loop that the Rust port
> replaces wholesale — do **not** invest in them now. Kept only as a record of known JS inefficiencies (and
> as behaviors the Rust core must reproduce, not the JS quirks).

- `nearOptimalCutoffs` (`search.ts`) iterates `layer.values()` twice per depth and recomputes `isSolved`
  (re-runs the `frozenCells` fixpoint) per state per pass. Fold the solved-check into the single
  expansion loop. Ice-chapter-only, bake-hashed.
- `frozenCells` / `cappedColors` (`ice.ts`) recomputed per node in `cappedSuccessors` and again in
  `isSolved`. Acceptable per the cheap-fixpoint argument; revisit only if the `benchmark` skill shows the
  ice (or new chapter-5) live tail near the spinner budget. The new `sealedTubes` fixpoint has the same
  shape — write it the same way and it inherits the same (acceptable) cost.

## Re-baking

`npm run build:levels` (≈8–10 min for the full campaign, deterministic). Any change to a bake-relevant
source bumps the `levelVersion.ts` hash; `baked.test.ts` fails until you re-bake. Re-baking reproduces
earlier chapters byte-identically (seed-deterministic) — that byte-identity is the regression check for
every new-mechanic change.
