# Plan

This file carries **open work only**. Everything already shipped is condensed to a one-line pointer
below — the full design rationale and as-built notes live in the memory notes, the README
"Architecture" section, and git history.

## Done (pointers, not tracked here)

- **Pre-baked curated levels (v2, difficulty-first)** — offline bake, size-normalized scoring, live
  budget + spinner, endless mode. See `baked-levels-plan` memo.
- **Chapter 1 — hidden colors** / **Chapter 2 — color-locked funnels** / **Chapter 3 — frozen tubes
  (ice)** — the three cumulative derived-overlay mechanics, all solvable-by-construction. See the
  `funnels-mechanic` and `ice-mechanic` memos. 240 levels baked across 4 chapters (Classic / Hidden
  Colors / Color Locks / Deep Freeze).
- **Mechanics made first-class** — the `MechanicModule` registry (`mechanics.ts`) + `Overlays` bundle
  (`overlays.ts`); the pipeline iterates the registry instead of naming mechanics. See `mechanic-registry`
  memo. (Round-2 R1/R2.)
- **Pure session loop** (`session.ts`, R3) + **injected live-gen budget/cache** (R4). Store is a thin
  adapter; the game-loop decision logic is unit-testable without Zustand/campaign/localStorage.
- **Round-1 code-quality sweep** (iterative solver DFS, interned `stateKey`, brand casts, store split,
  DRY fresh-state, param-list collapse). Items #1–#7 resolved; see git history.
- **Track A — polish (audio + haptics + hints)** — synthesized Web Audio SFX cues + a generative
  ambient **music** loop (default off) + `navigator.vibrate` haptics, driven off the pure
  `session.cueForTap` classification; Settings has Sound-Effects + Music **volume sliders** (music
  default 0/off) and a Haptics toggle (`store/settings.ts`, own localStorage key), and a Toolbar Hint
  button surfacing one optimal next
  pour via `search.hintMove`. **Taking a hint caps that attempt's rating to 1 star** (`hintUsed` flag,
  sticks across undos, resets on fresh board/restart; reflected live in `Stats`). Additive
  store→component layer; no engine change. NB it touched
  `search.ts` (a `levelVersion` SOURCE), so it forced a **byte-identical re-bake** — A was *not*
  fully re-bake-free as first scoped, but the board data is unchanged (only the version stamp moved).

Baseline today: lint / tsc / ~213 tests green; the engine/solver/generator split, derived-overlay
design, and registry are healthy. The work below is **growth and polish**, not debt.

---

# Next steps

Tracks chosen 2026-06-23. **A (polish) has SHIPPED** (see Done pointer above). Remaining near-term work
is **B (engagement)** and **C (accessibility)** — ordered by leverage-per-risk: **C (accessibility)** is
small, **B (engagement)** is medium. They're independent and can land in either order or in parallel.

**Track D (chapter 5 / new mechanic) is DEFERRED** (decided 2026-06-23) — design kept on file below, not
scheduled. Revisit once A/B/C have shipped and (per track B) there's playtest signal to justify a
re-bake. The D1-vs-D2 fork stays unresolved until then.

The non-negotiable invariant for anything touching boards: a mechanic is a **static, color-keyed,
position-independent overlay derived from the stored solution** — never an engine change, always
solvable by construction, always shuffle/recolor-safe. Track D lives or dies by this; A/B/C don't touch
it.

---

## B. Engagement — stats screen + daily challenge  (re-bake-free)

Surfaces data that already exists and adds one new seeded mode. Also the **prerequisite for data-driven
tuning** (see "Standing work" — the curve/funnel re-tune is currently blocked on having no playtest
signal).

**Backendless, confirmed (2026-06-23).** Everything here is **local-only** `localStorage` — no server,
the GH Pages static deploy is unchanged. Consequences to honor: the daily seed is derived client-side
(every device computes the *same* board from the date, so it's "shared" without a server); sharing is a
**copyable text result**, not a posted score; there are **no global leaderboards or cross-device sync**.
If those are ever wanted they're a separate backend project, explicitly out of scope here.

### B1. Real stats screen
`Stats.tsx` today shows only the *live attempt's* star rating. There is no aggregate view. The data is
already persisted in `campaign`/`progress` (`store/`): levels cleared, per-level stars, current frontier.
- Add an aggregate view (own screen or a Home panel): levels completed, total stars / 3-star count,
  chapter-by-chapter progress, current campaign position.
- Pure read over the existing persisted progress — no new persistence schema, no engine touch.

### B2. Daily challenge
- Generation is already **seeded and deterministic**. Derive a seed from the UTC date (`YYYY-MM-DD`),
  generate one board via the existing live generator (pick a mid/hard shape + the balanced mechanic
  density), and serve it as a once-a-day board. **Mechanic gating (defaulted): the daily uses the FULL
  mechanic set** (all of hidden/funnel/ice/…), independent of the player's campaign progress — a daily is
  a showcase, and a date-seed must be identical across devices, so it can't depend on per-player state.
  (If we'd rather not spoil un-reached mechanics, the alternative is to gate by the local frontier — but
  that makes the "same board everywhere" property false; flagged, not chosen.)
- Persist per-day result (solved / stars / move count) keyed by date string; show a small streak
  counter. A shareable text result ("Magic Color · 2026-06-23 · ⭐⭐ · 14 moves") is the share mechanism
  (copy to clipboard) — backendless by design.
- Reuse the loading spinner + live budget; the daily board is just another live-generated level with a
  fixed seed.

### B3. Endless-mode framing (small)
"Play Random" exists but has no best/streak framing. Add a personal-best move/streak counter (reads the
same progress store). Low effort; bundle with B1.

### Tests / verification
Daily: same date → same board (determinism), different dates → different boards; result persistence
round-trips. Stats: aggregates match a hand-built progress fixture. Preview-verify the new screen in
light/dark and a small viewport.

---

## C. Accessibility — colorblind support + cue audit  (re-bake-free)

The liquids are **hue-only** today. Ice added a frost texture and funnels a collar, but the base color
identity is still pure hue — a problem for the ~8% with color-vision deficiency, and the chapters stack
hue-coded cues (ice tint, funnel tint) on top of hue-coded liquid.

- **Per-color pattern/texture toggle** (decided 2026-06-23 — patterns, not glyphs). Fill each color
  with a distinct **pattern/texture** (e.g. diagonal stripes, dots, cross-hatch, solid) keyed off the
  branded `Color` — one stable pattern per palette entry in `theme/colors.ts`. **Off by default**, a
  Settings toggle. The `Color` brand makes it a clean render-layer change in `LiquidSegment`/`Bottle`
  (SVG `<pattern>` fills or a CSS background layered over the liquid color).
- **Design watch-out:** patterns must read cleanly *through* the existing overlay treatments — the ice
  frost layer and funnel collar sit on top of liquids, so verify the pattern + frost + tint don't turn
  into visual noise. Keep patterns low-contrast/subtle so they aid identification without fighting the
  liquid aesthetic. Pattern density must stay legible at the smallest segment height on mobile.
- **Cue audit across mechanics.** Confirm each mechanic is distinguishable **without** hue: hidden `?`
  glyph (ok), ice frost texture + rime line (ok), funnel collar shape (check it's not tint-only). Where a
  cue is tint-only, pair it with a shape/texture. Extend the same discipline to funnels and the new
  chapter (its lock indicator must carry a non-hue cue too).
- **Contrast pass** on the palette + text in light/dark.

### Verification
Preview the pattern toggle across a hidden+funnel+ice board, dark mode, small viewport; eyeball each
mechanic with patterns on to confirm no cue relies on hue alone AND that patterns stay legible under the
frost/collar overlays at the smallest segment size.

---

## D. Chapter 5 — new cumulative mechanic  (DEFERRED — forces a re-bake)

> **Parked 2026-06-23.** Not scheduled; revisit after A/B/C. The design below (the D1/D2 locking fork)
> is kept on file so the decision and rationale aren't lost — picking it back up means resolving the
> D1-vs-D2 question first, then following the implementation steps.

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

## Standing / iterative work (never "done")

- **Re-tune the curve.** Adjust `SCORE_WEIGHTS` / `CURVE` in `difficulty.ts` + `progression.ts` from
  real playtests, then re-bake. **Currently blocked on signal** — ship track B's stats first so tuning
  is data-driven rather than by-feel.
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
