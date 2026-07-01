# Plan

This file carries **open work only**. Shipped work is condensed to one-line pointers in
[DONE.md](DONE.md); the full design rationale and as-built notes live in the memory notes, the README
"Architecture" section, and git history.

Baseline: lint / tsc / tests green; the engine/solver/generator split, derived-overlay design, and
registry are healthy. The work below is **growth and polish**, not debt.

---

# Next steps

**Track E (debug & authoring tools) is the current priority** (added 2026-06-26): pure tooling that
touches neither the board invariant nor the bake output — surfacing the difficulty data we already
compute (in-app inspector + a provenance report/diff CLI) and adding the admin/solver hatches that make a
misbehaving level reproducible. It directly unblocks the **"re-tune the curve"** standing item, which is
otherwise blind. **E1 (Level Inspector + importable provenance) SHIPPED 2026-06-26** (see
[DONE.md](DONE.md)); **E2 is now the lead.**

**Track D (chapter 5 / new mechanic) stays DEFERRED** (decided 2026-06-23) — design kept on file below,
not scheduled. Picking it back up means resolving the D1-vs-D2 fork first, then following the steps.

The non-negotiable invariant for anything touching boards: a mechanic is a **static, color-keyed,
position-independent overlay derived from the stored solution** — never an engine change, always
solvable by construction, always shuffle/recolor-safe. Track D lives or dies by this; Track E doesn't
touch it.

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
run after the bake in `build:levels`), loaded only behind `import.meta.env.DEV` via `game/provenance.ts`
(`getProvenance(level)` / `loadProvenance()`) — verified dead-code-eliminated from the production bundle.
The remaining sub-tracks (E2 report/diff, E6 curve viz, E8 snapshot) read the same JSON / typed module.

### Priority order
1. ~~**E1 — Level Inspector overlay + importable provenance**~~ — **SHIPPED 2026-06-26** (see [DONE.md](DONE.md)).
2. ~~**E2 — Bake report / diff CLI**~~ — **SHIPPED 2026-06-26**, plus an **interactive React+Vite report app** (`report/`, also delivers E6) (see [DONE.md](DONE.md)).
3. ~~**E3 — Admin navigation, mode & seed controls**~~ — **SHIPPED 2026-06-26** (see [DONE.md](DONE.md)).
4. ~~**E4 — Solver / mechanic introspection**~~ — **SHIPPED 2026-06-26** (reveal-hidden, free-pour, auto-solve; force-terminal deferred) (see [DONE.md](DONE.md)).
5. **E5 — Single-level / single-chapter bake fast path** (the lead; tighten the offline iteration loop).
6. ~~**E6 — Curve visualization**~~ — **SHIPPED 2026-06-26** as the React report app's metric curves (see [DONE.md](DONE.md)).
7. **E7 — On-device solvability & quality assertion pass** (pre-commit gate for a re-bake).
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

---

### E7 — On-device solvability & quality assertion pass

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

---

### E9 — Diagnostics readout + live-config toggle + DEV gating of the hatch

- **Readout** in the admin section / extend the existing build/version footer: live-gen `liveCache` size,
  last `getLevel` timing, whether the current board is **baked vs live**, and the active `LiveGenConfig`.
- **Toggle `DEFAULT_LIVE_CONFIG` ⇄ `TEST_LIVE_CONFIG`** via `configureLiveGenerator` to feel the
  quality/latency tradeoff on a real device.
- **Gating decision (do this as part of E1/E3):** today's 7-tap gesture ships to every player. Keep only
  the harmless tools (jump-to-level, inspector readout) in the production gesture menu; gate the cheats
  (E4: reveal-hidden, auto-solve, free-pour) behind `import.meta.env.DEV`. The cheat tools must be
  unreachable in a production build, not merely undiscoverable.

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
