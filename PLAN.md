# Plan

This file carries **open work only**. Shipped work is condensed to one-line pointers in
[DONE.md](DONE.md); the full design rationale and as-built notes live in the memory notes, the README
"Architecture" section, and git history.

Baseline: lint / tsc / tests green; the engine/solver/generator split, derived-overlay design, and
registry are healthy. The rules now live in exactly ONE place — the **Rust core** (`core/`), compiled to
a native bake CLI and a `.wasm` worker; the JS solver/search/generator/difficulty/engine were deleted at
the Track F port, so there is no second implementation to drift from. The work below is **growth and
polish**, not debt.

The non-negotiable invariant for anything touching boards: a mechanic is a **static, color-keyed,
position-independent overlay derived from the stored solution** — never an engine change, always
solvable by construction, always shuffle/recolor-safe. Track D lives or dies by this; the Rust core
reimplements the same derived-overlay rules.

---

# Status of the big tracks

- **Track F (native + WASM core port) — DONE** (2026-07-03 → 2026-07-05). The whole port (F0–F6 + the
  F′ SOLID cleanup) shipped; the Rust core is authoritative for bake, solving, and live generation, and
  the cross-language drift gate retired. Condensed pointer + as-built summary in [DONE.md](DONE.md).
- **Track E (debug & authoring tools) — DONE.** E1–E4, E6, E9 shipped; E5/E7 absorbed into Track F and
  delivered. Only **E8** remains (below).
- **Track D (chapter 5 / new mechanic) — DEFERRED** (decided 2026-06-23). Design kept on file below, not
  scheduled. Picking it back up means resolving the D1-vs-D2 fork first, then following the steps.
  **Post-port, D2 (the turn-cadence "rhythm" mechanic) is dramatically cheaper** — its phase-aware solver
  + rejection sampling is exactly the heavy search the native core makes affordable.

With Track F done there is **no active priority track**. The next decision is whether to pick up Track D
chapter 5 (and if so, resolve D1 vs D2 — D1 is recommended for now). E8 is a small optional test that can
land anytime; the standing items are ongoing tuning.

---

## E8 — Golden curve snapshot regression test  (OPEN — optional)

A committed compact summary (per-level `score` + footprint + `mechanics`) that a **vitest snapshot** diffs
against. The crate-source hash (`levelVersion.ts` → `coreVersion`) catches *config/rule* drift, but not "an
unrelated change silently perturbed every board's score." The snapshot surfaces that in review; regenerate
intentionally on a real re-bake.

> **Partially covered already:** `scripts/build-history/<hash>.json` retains every bake's per-level data
> for after-the-fact comparison in the report app, and the hash guards catch config/rule drift. What E8
> still adds: an **automated, fail-fast vitest assertion** (build-history is a manual, opt-in diff).
> Scope E8 down to just that test. Marked optional at F5 — nice-to-have, not a blocker.

---

## D. Chapter 5 — new cumulative mechanic  (DEFERRED — forces a re-bake)

> **Parked 2026-06-23.** Not scheduled. The design below (the D1/D2 locking fork) is kept on file so the
> decision and rationale aren't lost — picking it back up means resolving the D1-vs-D2 question first,
> then following the implementation steps.

The registry (`mechanics.ts`) + `Overlays` bundle were built precisely so this is cheap: write the
overlay module, register it, add its data field to the few typed homes (`OverlaySet`, `BakedLevel`,
store, UI), add its density to `progression.ts`, bake. No new `*For` function, no positional-param
churn, no hand-written filter — the build/transform/serialize/filter/interaction logic is all
registry-driven (see `mechanic-registry` memo for the exact add-a-mechanic checklist). **Post-port note:**
the rule side of a new mechanic now lands in the **Rust core** (`core/`), with its DISPLAY-half overlay
transforms in the JS `mechanics.ts` registry; the "add-a-mechanic checklist" spans both.

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
  function of the board, so the canonical state key does not grow — sealed/unsealed is recomputed per node
  like `frozenCells`.
- A milder variant if pure keyed feels too close to ice: gate on a **count** ("opens once N colors are
  done") instead of a specific color — still board-derived, monotonic, free to derive. Same machinery.

#### Option D2 — **Periodic / turn-cadence locks** (the literal idea; bigger project)

A tube's opening is blocked on a move-count rhythm (period 2/3/4), blinking locked↔open as you play. This
is the literal *"every 2nd/3rd/4th turn"* idea and it's a genuinely fun, distinct mechanic — but it is
**not a drop-in chapter**; it's an engine/solver extension, closer in scope to the original baked-levels
effort. **Post-port, the search cost is affordable** (the native core makes the heavy rejection sampling
cheap), which is the main thing that made D2 impractical before:

- **Search grows a phase dimension.** State becomes `(bottles, hidden, moveCount mod L)` where `L` =
  lcm of the periods on the board (≤12). Bounded (≤12× state space) but real — the canonical key, A*
  (`optimalCappedMoves`), `bfsOptimal`, and the DFS all must thread the phase, and "useful move" pruning
  becomes phase-dependent. **All of this now lives in the Rust core**, not JS.
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

**This is a real fork to resolve before any D code is written.** D1 is a ~1-chapter effort that re-bakes
chapters 0–3 byte-identically; D2 is a multi-step solver project. A reasonable middle path: **ship D1 as
chapter 5 now**, and keep D2 on file as a future "rhythm" chapter once there's appetite for the solver work.

**Also-rejected — directional / one-way tubes ("wind").** Adjacency/direction is *position-dependent*,
which fights the color-keyed, shuffle-safe overlay design (the constraint would have to be re-derived
after every shuffle). Not an overlay; a separate larger project if ever wanted.

> The implementation steps + tests below are written for **D1 (progress-gated locks)**, the recommended
> path. If D2 is chosen instead, this section gets rewritten around the phase-aware solver — most of the
> module/registry/UI wiring carries over, but steps 1, 5, 6 and the whole "free solvability" argument are
> replaced by the search-phase + rejection-sampling work.

### Implementation — D1 (follow the `ice.ts` blueprint + the registry checklist)
> **Post-port adjustment:** the rule/derivation side (steps 1, 2, 5's presence filter, 6) is now Rust in
> `core/`; the JS `mechanics.ts` registry keeps only the DISPLAY-half overlay transforms. The shape of the
> work below is unchanged — read "new module" as "new Rust module + its JS display overlay + shared vector".

1. `core/src/locks.rs` (new) — per-tube trigger color, `sealed_tubes(state, locks)` (the completed-color
   fixpoint, reusing the cascade pattern from `frozen_cells`), `lock_eligible_tubes(state, solution)`
   (per-tube earliest-use vs. `completed_at`), the seeded per-tube seal + force-one fallback (own XOR
   constant), and recolor. Its blocking/accepts/incomplete ops seal the tube in **and** out and block
   completion. Pure, unit-tested in isolation; mirror to a JS display overlay + a G1 shared vector.
2. Register it in the mechanic order (`MECHANIC_ORDER`, shared constant across core + JS).
3. Typed homes: `Mechanic` union (`types.ts`); `OverlaySet` + `BakedLevel` field; store fields
   (`locks`/`initialLocks`); the UI field.
4. `progression.ts`: `MECHANIC_SETS[4] = ['hidden','funnel','ice','locks']`, the three density literals
   (signature/inherited/balanced), `campaignDensity`, `CHAPTER_LEN` math (`DEFINED_CHAPTERS`→5,
   `CAMPAIGN_LENGTH`→300, chapter 4 = levels 241–300). `chapters.ts`: add the name. (Progression is shared
   core + JS — keep the constants in lockstep, G5 checks them.)
5. Bake filter: chapter-5 pool keeps only boards with a sealed tube (register the mechanic's presence check).
6. **Difficulty term** `lockLoad`, gated into the composite score ONLY when the pool has locks (same gate as
   `funnelLoad`/`iceLoad`, so chapters 0–3 re-bake byte-identically — do not shift the denominator otherwise).
7. **Visuals** (`Bottle.tsx` + CSS): a padlock / sealed-cap treatment tinted with the trigger color
   (`--lock` var, same plumbing as `--funnel`/`--ice`), a satisfying unlock animation on trigger
   completion. **Pair with a non-hue cue** (padlock glyph) per track C — don't rely on tint alone.
8. **Bake + verify:** `npm run build:levels` (~2 min, native bake). Confirm chapters 0–3 reproduce
   **byte-identically** (only the version hash + the new all-null `locks` field change), `baked.test.ts`
   passes, the `exe/test` gate (G1/G3/G4/G5) is green, and run the `benchmark` skill so the live tail stays
   within the spinner budget.

### Tests
Eligibility (earliest-use-vs-completion ordering, source **and** destination); the seed + force-one seal +
RNG-stream alignment; `sealed_tubes` fixpoint incl. a multi-step cascade and a no-cascade board; recolor
lockstep with the board map; **solvability** (the stored solution opens every tube and wins) over many
seeds/shapes; **monotonicity** (more/earlier seals ⇒ `lockLoad`/`optimal` non-decreasing); chapters 0–3
unchanged when `locks` is absent. Store: restart recolor/shuffle keeps lock triggers matched to liquid;
pour **into** and **out of** a sealed tube both rejected; injected-board lock reset (the `funnels-mechanic`
memo gotcha — injected test boards must reset `locks`/`initialLocks`). Plus a **G1 shared vector** for the
lock rule so the core and any JS display twin move together.

---

## Standing / iterative work (never "done")

- **Re-tune the curve.** Adjust `SCORE_WEIGHTS` / `CURVE` in the core's difficulty/progression from real
  playtests, then re-bake. The feedback loop is in place — use **`npm run levels:report`** (or the report
  app's build-history comparison): snapshot the current `levels.provenance.json`, change weights, re-bake,
  then diff the two so each weight pass is measured per-level rather than by-feel.
- **Settle the funnel knobs.** The `funnelLoad` formula and per-board lock cap were left to settle by
  feel; revisit alongside playtest re-bakes.
- **Mechanic-density tuning.** The signature/inherited/balanced density literals are tuned against how
  chapters *read*; revisit per chapter as new mechanics land.

## Re-baking

`npm run build:levels` (≈2 min — the native Rust bake: `scripts/levels.ts` shells `bake --out bake-out`
then `emit-baked-from-rust.ts` + the provenance/archive steps). Any change to a bake-relevant source
(now in `core/`) bumps the crate-source hash; `baked.test.ts` fails until you re-bake. Re-baking reproduces
earlier chapters byte-identically (seed-deterministic) — that byte-identity is the regression check for
every new-mechanic change. Single-slice fast paths: `bake --chapter N` / `--level N`.
