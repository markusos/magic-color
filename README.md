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
    types.ts            # Color, Bottle, GameState, Move, LevelDef, GeneratedLevel
    engine.ts           # canPour, pour, isComplete, isWon, isDeadlocked
    solver.ts           # solve() (DFS), bfsOptimal(), canonical state key
    generator.ts        # isValidCombo(), generateLevel() — guaranteed solvable
    levels.ts           # difficulty tiers (normal / hard / superHard)
  store/
    gameStore.ts        # Zustand store: selection, pour, undo, restart, add-tube
  components/           # Bottle, LiquidSegment, GameBoard, Toolbar, Overlay
  theme/                # color palette + design tokens
```

### Guaranteed-solvable level generation

`generateLevel` never emits an unsolvable board. It builds a balanced multiset of color
segments (4 of each color), shuffles with a seeded PRNG, deals into bottles, and then
**verifies with the solver** (rejection sampling). The accepted board ships with a known
solution and its step count (`minMoves`). Generation is restricted to "known-good" combos
(`isValidCombo`): 1–2 empty bottles, 2–12 colors. Seeds make levels reproducible.

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
