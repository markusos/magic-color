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
