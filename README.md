# Magic Color

A TypeScript SPA color-sorting puzzle (water-sort genre).
Tap a bottle to pick it up, tap another to pour the top color — solve a level when every
bottle holds a single solid color or is empty.

Built with **Vite + React + TypeScript**, **Zustand** for state, and **Framer Motion**
for the pour/tilt animations.

## Getting started

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run test     # run the engine/solver/store unit tests
npm run build    # type-check + production build
```

## Architecture

The game logic is a **pure, framework-agnostic engine** (no React, no DOM) so it can be
unit-tested in isolation and reused later (e.g. a Node backend). React only renders state
and dispatches taps.

```
src/
  game/                 # pure engine — the heart of the game
    types.ts            # Color, Bottle, GameState, Move, GeneratedLevel
    engine.ts           # canPour, pour, isComplete, isWon, isDeadlocked
    solver.ts           # solve() (DFS), bfsOptimal(), usefulMoves()
    search.ts           # shared graph search + optimalCappedMoves (hidden-aware A*)
    generator.ts        # generateLevel() / generateCandidates() — guaranteed solvable
    hidden.ts           # the "hidden colors" mechanic (concealed cells, capping)
    difficulty.ts       # offline difficulty metrics, composite score, slot assignment
    progression.ts      # campaign CONFIG: shape menu, chapters, difficulty curve (bake-hashed)
    levelLoader.ts      # runtime: getLevel() — baked board, else live generation; random-hard
    levels.data.ts      # AUTO-GENERATED baked campaign (npm run build:levels)
  store/
    gameStore.ts        # Zustand store: selection, pour, undo, restart, level/endless modes
    campaign.ts/progress.ts  # persisted progress (localStorage)
  components/           # Bottle, LiquidSegment, GameBoard, Loader, Toolbar, Overlay, Home, …
  theme/                # color palette + design tokens
scripts/
  build-levels.ts       # offline bake: generate a pool, score, assign to the curve
```

### Progression: difficulty-first, with pre-baked levels

Difficulty is **decoupled from board size**. A level's difficulty comes from where it sits on a
per-chapter ease-in curve, not from its tube count — so a tricky 5-tube board can be "harder" than a
sprawling 15-tube one. **Chapters** layer cumulative mechanics (chapter 1 adds *hidden colors*).

The first **60 levels are pre-baked offline** (`npm run build:levels`): the script generates a large
pool of boards across a *shape menu* (small / tall 5-tube up to 12-high / medium / large), scores each
with a **size-normalized composite** (exact optimal, forced-move ratio, dead-end density, dig depth),
and assigns boards to the curve with shape variety. The result is committed to `levels.data.ts`; a
staleness test re-stamps it if the bake logic changes. Levels past 60 — and the post-campaign
**Play Random Hard** endless mode — are generated **live** (best-of-N within a ~1–2s budget, behind a
spinner). Persistence stores only the level number; boards are baked or regenerated on demand.

### Guaranteed-solvable level generation

`generateLevel` never emits an unsolvable board. It builds a balanced multiset of color segments
(`capacity` of each color), shuffles with a seeded PRNG, deals into bottles, and then **verifies with
the solver** (rejection sampling). The accepted board ships with a known solution and its step count
(`minMoves`). Seeds make generation reproducible.

## Deployment (GitHub Pages)

Pushing to `main` triggers [.github/workflows/deploy.yml](.github/workflows/deploy.yml),
which runs the tests, builds, and publishes `dist/` to GitHub Pages.

One-time setup:

1. Create the `magic-color` repo on GitHub and push this branch.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The app goes live at `https://<user>.github.io/magic-color/`.

Vite's `base` is **relative (`./`)**, so the exact same build works at the Pages
subpath *and* at a root custom domain — no config change needed when switching.

### Custom domain (`magic-color.ostberg.dev`) — when ready

1. **DNS** (at your DNS provider for `ostberg.dev`): add a `CNAME` record
   `magic-color` → `<user>.github.io`.
2. Add a `public/CNAME` file containing `magic-color.ostberg.dev`, then commit + push
   (Vite copies it to `dist/CNAME`). Equivalently, set it in **Settings → Pages →
   Custom domain**.
3. Once the cert is provisioned, tick **Enforce HTTPS**.

Do this *after* the default URL is working — adding the custom domain makes the
`.github.io` URL redirect to it, which only resolves once DNS is live. The PWA needs no
rebuild for the move because all paths are relative.

> **PWA install note:** the service worker (offline support) only registers over HTTPS,
> which both the `.github.io` URL and the custom domain provide. Install on iOS via
> Safari → Share → **Add to Home Screen** while online once; it then runs fully offline.
