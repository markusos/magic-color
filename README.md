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

## Roadmap (deferred)

Node backend + persistence/leaderboards, the meta-loop (potions/cauldron, ingredients),
seasonal events, Rive animations and interactive background (cat, fireplace, mage tower),
Shuffle tool, hints, and sound.
