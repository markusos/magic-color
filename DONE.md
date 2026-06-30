# Done

Shipped work, condensed to pointers. Open work lives in [PLAN.md](PLAN.md); the full design rationale
and as-built notes live in the memory notes, the README "Architecture" section, and git history.

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
  button surfacing one optimal next pour via `search.hintMove`. **Taking a hint caps that attempt's
  rating to 1 star** (`hintUsed` flag, sticks across undos, resets on fresh board/restart; reflected
  live in `Stats`). Additive store→component layer; no engine change. NB it touched `search.ts` (a
  `levelVersion` SOURCE), so it forced a **byte-identical re-bake** — A was *not* fully re-bake-free as
  first scoped, but the board data is unchanged (only the version stamp moved).
- **Track C — accessibility (colorblind patterns)** — a "Color Patterns" Settings toggle (off by
  default) that overlays a distinct texture per palette color (`PATTERN_FOR` in `theme/colors.ts` →
  `.cb-pattern[data-cb]` rules in `theme/tokens.css`), so a color is identifiable without hue. Applied
  to liquid segments, the funnel collar, and the ice-trigger badge (the color-carrying overlays);
  hidden `?` stays plain. Pure render-layer (`patterns` flag threaded GameBoard→Bottle→LiquidSegment);
  no engine/bake touch. Dark-only app, palette already ΔE-tuned, so the contrast pass was a no-op.
- **Track B1 — real stats screen** (2026-06-24) — `StatsScreen` at route `stats` (linked from Home,
  shown once past level 1). Aggregation is a pure, tested fold `aggregateProgress(progress)` in
  `store/progressStats.ts`, exposed via `campaign.stats()` → `gameStore.campaignStats()` so the
  component never touches localStorage directly. Shows levels cleared, stars earned, 3-star clears,
  current position, per-chapter breakdown, **lifetime hints used**, and the random best streak (B3).
  "Completed" counts only star-recorded levels (excludes the admin-unlock sentinel). Pure read; the
  only new persistence is an additive `hintsUsed` counter on the progress blob (incremented per hint
  tap; cleared by Start Over with everything else). See `track-b-engagement` memo.
- **Track B3 — endless-mode framing** (2026-06-24) — the persisted `randomHardBestStreak` is surfaced
  as a "Best random streak" row on the stats screen; the redundant Home "Best streak N" caption was
  removed. No new persistence. Bundled with B1.
- **Track B2 — daily challenge** (2026-06-24) — a date-seeded showcase board, fully backendless. Pure
  date↔seed↔streak↔share logic in `game/daily.ts` (`dailyKey`/`dailySeed`/`dailyStreak`/`dailyShareText`,
  UTC so the board is identical across devices with no server); `generateDailyLevel(key)` in
  `levelLoader.ts` picks a mid/hard shape best-of-N with the FULL mechanic set + balanced density,
  memoized per date. New `'daily'` `GameMode` in the store (`playDaily`/`applyDaily`; win records via
  `campaign.recordDaily`, refreshes `dailyStreak`/`dailyResult`; `nextLevel` no-ops). Additive
  `daily: Record<date, {stars,moves}>` on the progress blob (no version bump; older saves default `{}`).
  UI: Home "Daily Challenge" button with streak/done chip, GameScreen "Daily · date" header, win overlay
  with copy-to-clipboard "Share Result" + "Home", and a daily-streak row on the stats screen. Completes
  Track B. See `track-b-engagement` memo.
  - **Sharing** — `dailyShareText` (daily.ts) appends the deployed game URL (`GAME_URL`) on its own line
    so a paste links back to play. A UI-agnostic `shareOrCopy` helper (`src/share.ts`, unit-tested)
    prefers the native Web Share API (system share sheet on phones), falls back to a clipboard copy
    elsewhere, and respects a user-cancelled share (AbortError → no silent copy). A share button in
    Home's top-left corner (mirroring the Settings cog) shares the game itself; it flips to a check
    ("Link copied") for 2s on the copy fallback.
- **Track E1 — Level Inspector + importable provenance** (2026-06-26) — a floating debug overlay
  (`components/Debug/InspectorPanel.tsx`) toggled from the Settings admin hatch (new `inspector` flag in
  `store/settings.ts`) that surfaces the active board's live `PlayableLevel` metadata (source baked/live,
  phase/chapter, footprint, mechanics, optimal/2★) plus the baked level's bake-time provenance (score vs.
  curve target, family, the six difficulty metrics). Provenance is mirrored from the committed
  `scripts/levels.provenance.json` into a generated, tree-shakeable `src/game/levels.provenance.ts` by a
  standalone `scripts/emit-provenance.ts` (kept out of the hash-tracked `build-levels.ts` to avoid forcing
  a re-bake; wired after the bake in `build:levels`), and loaded only behind `import.meta.env.DEV` via
  `game/provenance.ts` — verified dead-code-eliminated from the production bundle. The spine (importable
  provenance) is reused by the rest of Track E. The readout renders as the ⓘ popover (same shell +
  backdrop-dismiss as how-to-play). **Live boards** (random/endless, daily, un-baked tail) show their own
  *approximate* metrics too: `pickBest` already measures every finalist, so the chosen board's metrics are
  retained as `LiveProvenance` on the (non-hashed) `LoadedLevel` → store `liveProvenance` → inspector,
  marked "live · approx" (proxy optimal, pool-relative score). All metric display is behind `import.meta.env.DEV`.
- **Track E2 — bake report / diff CLI** (2026-06-26) — `npm run levels:report` over the bake provenance
  sidecar. **Report** (no/one path arg): an ASCII score-distribution histogram plus, per chapter,
  score/optimal stats, exact-optimal rate, family mix, the five metric means, and within-chapter
  monotonicity slips — the condensed read the bake's console dump buries. **Diff** (two path args): joins
  two bakes by level and prints added/removed plus changed levels (Δscore / score / Δoptimal / family),
  sorted by |Δscore| — so a `SCORE_WEIGHTS`/`SHAPES` change yields a precise per-level delta instead of
  eyeballing. All analysis is pure + unit-tested in `src/game/levelReport.ts` (`numStats`, `histogram`,
  `monotonicityViolations`, `buildReport`, `diffProvenance`); the script is a thin IO/format shell, kept
  out of the bake hash so it never forces a re-bake. Unblocks the standing "re-tune the curve" item.
- **Track E2/E6 — interactive React+Vite bake report** (2026-06-26) — a standalone report app under
  `report/` with its own `vite.report.config.ts` (separate root/port 5174/`dist-report` output), fully
  decoupled from the shipped game so the dev-only provenance never enters the app bundle. `npm run
  report:dev` for HMR while building reports, `npm run report:build` for a self-contained static artifact
  (~224 KB) to open or share. Renders every difficulty metric as a curve across the campaign with chapter
  bands and a **shared hover crosshair** that drives a per-level detail panel; plus the per-chapter summary
  table (monotonicity slips flagged), a score-distribution histogram, and a **Compare file…** loader
  (drag-drop a provenance JSON) that overlays the comparison curve on every chart and renders the diff
  table. Reuses the game's typed/tested analysis (`src/game/levelReport.ts`) and the committed provenance
  module; report code is linted + typechecked (added `report/` to tsconfig + the gate). This is also the
  substantive delivery of E6 (curve visualization).
