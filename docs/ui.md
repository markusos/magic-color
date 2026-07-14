# UI & Visuals Review

_A gameplay-experience review focused on **UI and visuals only** — no new game mechanics. Ranked
recommendations plus a sequenced implementation plan. Reviewed 2026-07-14 against
`claude/gameplay-experience-review-j9jy1u`, playing through all four chapters (Classic, Hidden
Colors, Color Locks, Deep Freeze) plus the selection, hint, and win states on mobile and desktop._

## TL;DR

The game is **already well-polished**. The glass tubes, the tilt/lift on selection, the cork-cap
reward on a completed tube, the live star-rating preview, and the built-in colorblind pattern
system are all genuinely good and should be protected. The recommendations below are about
**closing experience gaps**, not fixing defects.

The two highest-value changes are both self-contained UI work:

1. **Teach each mechanic when it first appears** — new mechanics currently arrive with zero
   explanation.
2. **Make the win moment celebratory and informative** — the win overlay is tasteful but flat and
   shows no score feedback, despite the data already existing.

Everything here is presentational. None of it changes a board, a rule, or the generator, so none
of it forces a campaign re-bake or touches the Rust core.

## Status

**Shipped: U1–U7** (Phases 1–3), each behind the quality gate with tests. **U8** (optional move
counter, Phase 4) is intentionally not built pending appetite — the minimalist header is a
deliberate choice. Notes on partial outcomes are inline under each item.

| Item | State |
| --- | --- |
| U1 — Mechanic onboarding | ✅ Shipped |
| U2 — Win celebration + score feedback | ✅ Shipped |
| U3 — Funnel (Color Lock) legibility | ✅ Shipped |
| U4 — Board dead space / sizing | ✅ Shipped (wide-screen sizing + stage glow; phone few-row space is an inherent grid trade-off — see U4) |
| U5 — Concealed-cell texture + reveal | ✅ Shipped |
| U6 — Surface the colorblind aid | ✅ Shipped |
| U7 — Illegal-tap feedback | ✅ Shipped |
| U8 — Optional move counter | ⏸️ Deferred (optional) |

---

## What we're doing well (protect these)

These are load-bearing strengths. Keep them as the bar for new visual work.

1. **Tactile bottle feedback.** Selecting a tube lifts and tilts it (`Bottle.module.css`), and legal
   destinations get a gold ring (`.target`). The pour/tilt springs read as physical, not as UI
   state changing.
2. **The cork cap as a completion reward.** A finished tube gets a cork lid that drops in via Framer
   Motion (`.cap`). It's a small, satisfying "done" beat mid-board — more of this energy, please.
3. **Live star preview.** The header stars dim as the running score crosses each threshold
   (`Stats.tsx`), so the player always knows the rating they're heading for. Elegant and quiet.
4. **Accessibility groundwork.** The `.cb-pattern` colorblind texture system (`theme/tokens.css`) is
   thorough and calm, and `prefers-reduced-motion` is already respected across animations. The
   recommendations below all preserve these paths.

---

## Recommendations (ranked)

Effort is a rough T-shirt size. "Files" lists the primary touch points, not an exhaustive list.

### High impact

#### U1 — Teach each mechanic when it first appears
**Effort: M · Files: `InfoButton.tsx`, `chapters.ts`, new chapter-intro component, `GameScreen.tsx`**

The single biggest gap. New mechanics arrive with **no explanation**: Hidden Colors at L61, Color
Locks at L121, Deep Freeze at L181. A player reaching a frozen tube sees a snowflake badge and an
ice sheet with no idea what it does or how to clear it. The "How to play" popover (`InfoButton.tsx`)
is a static string describing only the **base** rules — verified identical on L181, a board that has
hidden cells, funnels, *and* ice on screen simultaneously. Chapters have display names
(`chapters.ts`) but no mechanic teaching anywhere.

- **Proposal:** a one-time chapter-intro card shown on first entry into a chapter ("Deep Freeze —
  frozen tubes thaw when you complete their color"), with a small static or animated example.
  Persist a "seen" flag per chapter (same localStorage pattern as `progress.ts`). Additionally, make
  the `InfoButton` help content **chapter-aware** so re-opening it lists the mechanics currently in
  play, not just the base rules.
- **Why first:** it's the largest experience gap, it's pure presentation, and it unblocks nothing
  else — safe to ship independently.

#### U2 — Make the win moment celebratory and informative
**Effort: M · Files: `Overlay.tsx`, `Overlay.module.css`, new confetti/particle component**

The win overlay (screenshot: `docs`-referenced review) springs the stars in with a "Perfect!" and a
single button — tasteful but flat. Two problems: there's **no celebration** (no confetti/particle
burst), and it shows **no score feedback**. The store already tracks `moves`, `optimal`, and the
per-level best (`progress.ts` `best[level]`), but none of it surfaces at the win — so there's no
"beat my score" hook, which is where sorting puzzles earn replay.

- **Proposal:** a confetti/particle burst on a 3-star clear (gated behind `prefers-reduced-motion`,
  which the overlay already honors elsewhere); a score line such as `12 moves · optimal 8`; and a
  "New best!" badge when the run beats `best[level]`. No new data — just render what exists.
- **Why second:** highest emotional payoff per line of code, and fully self-contained.

#### U3 — Strengthen the funnel (Color Lock) visual
**Effort: S · Files: `Bottle.module.css` (`.funnel`), `Bottle.tsx`**

On L121 the funnel collar is a soft neck gradient at ~78% opacity (`.funnel`). It's genuinely easy
to miss which tube is locked to which color — especially when the locked color matches the current
top liquid. For a mechanic whose entire point is "this tube only accepts X," the cue is too quiet,
particularly next to the much clearer ice badge treatment.

- **Proposal:** a more defined collar — a colored ring at the neck plus a small color chip/icon,
  echoing the clarity the ice badge already has (`.iceBadge`). Keep it clipped to the tube so narrow
  boards aren't affected.

### Medium impact

#### U4 — Reclaim the dead space on small boards
**Effort: M · Files: `useBottleMetrics.ts`, `GameBoard.module.css`, `App.module.css`**

`useBottleMetrics.ts` caps tube width at `MAX_WIDTH = 88` with a fixed 5-column grid
(`TUBES_PER_ROW = 5`), and the board is vertically centered. On a phone, a 5-tube board floats as
small tubes in a large void with a wide gap between the star row and the board top; on desktop it's
a narrow centered column in a wide empty field.

- **Proposal:** relax/raise the max width so small boards grow to fill more height, tighten the
  header→board gap, and/or add a subtle "shelf"/reflection the tubes rest on for grounding (they
  currently float). Desktop could frame the board or use a richer backdrop. Re-check the lift/tilt
  headroom math (`LIFT_ROOM_F`, `ROW_GAP_F`) after any size change.
- **Note:** the current centering is ergonomically fine (board sits in thumb reach); this is about
  visual density, so treat it as tuning, not a rewrite.
- **Outcome (shipped):** raised `MAX_WIDTH` 88 → 120, which lets 1-row boards fill wide screens
  (desktop 5-tube grew 88 → 120px; phones are width-bound far below the cap, so unchanged), and
  added an ambient "stage" glow behind the board for grounding. The phone few-row void turned out to
  be **inherent to the fixed 5-per-row, no-ragged-row grid** (a deliberate existing choice): a
  5-tube board is one short row, and making its tubes bigger would require reflowing into ragged
  rows or pushing the board out of thumb reach. Left as-is by design rather than fought; the glow
  softens the perception. Repositioning/`App.module.css` gap-tightening was evaluated and dropped
  (hurts reach for negligible gain).

#### U5 — Soften and animate the concealed cells
**Effort: S–M · Files: `Bottle.tsx` (`.mark`), `LiquidSegment.tsx`, relevant CSS**

Hidden cells render as near-pure-black bands with a white "?". Against the vibrant liquids they read
as *holes* rather than "mystery liquid," and the reveal on pour is instant.

- **Proposal:** give concealed cells a faint frosted/marbled dark texture (or a slow shimmer) so
  they read as covered liquid, and add a quick dissolve/flip when a cell is uncovered — a small
  "reveal" beat that rewards digging. Keep the `.cb-pattern` overlay compatibility.

#### U6 — Surface the colorblind aid
**Effort: S · Files: `Settings.tsx`, possibly a first-run nudge in `Home.tsx`/`GameScreen.tsx`**

The Color Patterns system (`theme/tokens.css`) is excellent but off by default and buried in
Settings. Several palette pairs sit close (the two greens, royal-blue vs indigo, the pinks).

- **Proposal:** a first-run nudge or more prominent Settings placement. No new system needed — it's
  already built; this is discoverability only.

### Polish / nice-to-have

#### U7 — Illegal-tap feedback
**Effort: S · Files: `Bottle.tsx`, `GameBoard.tsx`, `gameStore.ts` (surface a rejected-tap signal)**

Tapping an invalid destination currently does nothing visible. A tiny shake on the rejected tube
(reduced-motion aware) closes the feedback loop. Purely visual — the store already rejects the move;
this only animates the rejection.

#### U8 — Optional move counter
**Effort: S · Files: `Stats.tsx`, `Settings.tsx`**

The live-dimming star preview is elegant, but some players want a raw `moves / best` readout. Worth
offering as an **option** rather than a default — the minimalist default is a deliberate, good
choice.

---

## Implementation plan

Ordered for **shippable increments**, each independently mergeable and reversible. Rationale:
front-load the two highest-impact items (they're self-contained and unblock nothing), then batch the
cheap high-clarity wins, then the layout tuning that needs the most QA.

### Phase 1 — Highest impact, self-contained (do first) ✅ done
1. **U2 — Win celebration + score feedback.** Smallest blast radius, biggest emotional payoff, uses
   only existing data. Good warm-up that touches one screen.
2. **U1 — Mechanic onboarding.** Largest experience gap. Slightly bigger (new component +
   per-chapter "seen" persistence + chapter-aware help), so it follows U2.

### Phase 2 — Cheap clarity wins (batch together) ✅ done
3. **U3 — Funnel collar.** Small CSS/markup change; big legibility gain for Color Locks.
4. **U6 — Surface the colorblind aid.** Small; pairs naturally with clarity work.
5. **U7 — Illegal-tap shake.** Small; rounds out the feedback loop started by U3.

### Phase 3 — Depth & density (more QA) ✅ done
6. **U5 — Concealed-cell texture + reveal.** Visual richness; needs care around the `.cb-pattern`
   overlay and the reveal timing.
7. **U4 — Board sizing / dead space.** Do last: it's the highest-QA item (re-tune lift/tilt headroom
   across phone sizes and desktop, verify no scroll/clip regressions) and benefits from the other
   changes being settled so layout is only tuned once.

### Phase 4 — Optional ⏸️ not started
8. **U8 — Move counter option.** Ship only if there's appetite; it slightly complicates the
   deliberately minimal header.

### Sequencing notes
- Each item is independently revertible; there are **no hard dependencies** between them. The order
  optimizes for value-per-merge and for tuning layout (U4) only once, after the other visual changes
  land.
- Every item must preserve the existing `prefers-reduced-motion` and `.cb-pattern` paths — treat
  both as acceptance criteria, not afterthoughts.
- None of these touch `core/`, the generator, or the baked levels, so `npm run check` (app lane) is
  the relevant gate; no re-bake is required.
