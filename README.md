# Magic Color

A color-sorting puzzle (water-sort genre) that runs as an installable PWA.
Tap a bottle to pick it up, tap another to pour the top color — a level is solved when every
bottle holds a single solid color or is empty. Layered mechanics (hidden colors, color-locked
funnels, frozen tubes) arrive chapter by chapter, plus a daily challenge and an endless mode.

The **UI is Vite + React + TypeScript** (Zustand for state, Framer Motion for the pour/tilt
animations). The **game core — rules, generator, solver, difficulty model — is a Rust crate**
compiled two ways: to a native binary for the offline level bake, and to WebAssembly for the
in-browser runtime. One implementation drives everything, so a bake and a live board can never
disagree.

## Getting started

```bash
npm install
npm run dev      # dev server (http://localhost:5173)
npm run check    # the full quality gate — see below
npm run build    # type-check + production build
```

Working on the browser app alone needs only Node — the compiled wasm core is committed under
`src/game/core-pkg/`, so `npm run dev`/`build` work without a Rust toolchain. You only need Rust
when changing the core (see [The Rust core](#the-rust-core)).

## Architecture

The gameplay logic lives **once**, in the Rust `core/` crate. It compiles to:

- a **native binary** (`bake`) that generates and scores the campaign offline, and
- **WebAssembly** (`core-pkg/`, built with `wasm-pack`) that the browser runtime calls for live
  generation, hints/auto-solve, and the stuck-loop check.

React only renders state and dispatches taps; the Zustand store (`src/store/`) owns selection,
pour, undo, restart, and the campaign/endless/daily modes. The Rust crate is the **only**
implementation of the game rules: the JS twins that once mirrored it were retired after the port
proved parity, and tests that need to "play" a board drive the committed wasm through the same
adapter seams the store uses (`src/test/core.ts`). The core is pinned against regression by its
own unit tests plus **frozen golden vectors** (`vectors/*.json`, captured from the JS
implementation at cutover — see `vectors/README.md`).

```
core/                     # the Rust game core (workspace crate `magic-color-core`)
  src/
    engine.rs             # pour / capped-pour / win / deadlock rules
    solver.rs, search.rs  # BFS optimum + hidden-aware A* (hints, optimal counts)
    generator.rs, live.rs # guaranteed-solvable generation (offline + live best-of-N)
    difficulty.rs         # size-normalized composite difficulty score + slot assignment
    progression.rs        # campaign config: shape menu, chapters, difficulty curve
    hidden.rs, funnels.rs, ice.rs, mechanics.rs   # the layered mechanics
    session.rs, state.rs, types.rs, rng.rs, jsnum.rs
    wasm.rs               # wasm-bindgen boundary (flat byte protocol)
    bin/bake.rs           # native CLI: bake the campaign to JSON
    bin/verify.rs         # native CLI: self-check emitted level artifacts
  tests/                  # crate tests + frozen golden-vector replays

vectors/                  # FROZEN golden vectors pinning the core (see vectors/README.md)

src/
  game/
    core-pkg/             # AUTO-GENERATED committed wasm package (npm run core:wasm)
    coreWasm.ts           # adapter over the wasm core (palette-id ↔ flat-byte boundary)
    coreHintWorker.ts     # Web Worker running the core's A* off the main thread
    levelLoader.ts        # getLevel(): committed baked board, else live generation via the core
    levels.data.ts        # AUTO-GENERATED baked boards (npm run build:levels)
    levels.meta.ts        # AUTO-GENERATED bake metadata + generator-version stamp
    daily.ts, stars.ts, palette.ts, recolor.ts, overlays.ts, …   # runtime helpers
  store/                  # Zustand store + persisted campaign/daily progress (localStorage)
  components/             # Bottle, GameBoard, Toolbar, Overlay, Home, StatsScreen, Settings, …
scripts/                  # bake pipeline glue + version stamps + the quality-gate orchestrator
scripts/gate.ts           # the quality gate as a reusable module (run by exe/test AND CI)
e2e/                      # Playwright browser smokes (run against a production build)
exe/test                  # thin launcher for the gate (→ scripts/check.ts)
```

### Progression & mechanics

Difficulty is **decoupled from board size** — a level's difficulty comes from where it sits on a
per-chapter ease-in curve, not from its tube count, so a tricky 5-tube board can be "harder" than a
sprawling 15-tube one. **Chapters** layer cumulative mechanics, each enforced at the interaction
layer and derived from the stored solution so the board provably stays solvable:

| Chapter | Name | Adds |
| --- | --- | --- |
| 0 | Classic | base water-sort |
| 1 | Hidden Colors | concealed cells revealed as you pour |
| 2 | Color Locks | funnels — tubes that accept only one color |
| 3 | Deep Freeze | frozen tubes that thaw when capped |

**240 levels (4 chapters × 60) are pre-baked offline** (`npm run build:levels`): the native bake
generates a large pool across a *shape menu* (small / tall 5-tube / medium / large), scores each
with a size-normalized composite (exact optimal, forced-move ratio, dead-end density, dig depth,
mechanic load), and assigns boards to the curve with shape variety. The result is committed to
`levels.data.ts`. Levels past the baked range — and the post-campaign **Play Random** endless
mode and the date-seeded **Daily Challenge** — are generated **live** through the wasm core
(best-of-N within a short budget, behind a spinner). Persistence stores only progress; boards are
baked or regenerated on demand.

### Guaranteed-solvable generation

The generator never emits an unsolvable board: it builds a balanced multiset of color segments,
shuffles with a seeded PRNG, deals into bottles, then **verifies with the solver** (rejection
sampling). Every accepted board ships with a known solution and its optimal step count. Seeds make
generation reproducible, and the RNG is bit-identical (`libm`) between the native and wasm targets
so a live board matches the bake.

## The quality gate — `scripts/gate.ts`

One quality gate, defined once in TypeScript (`scripts/gate.ts`) and run everywhere: `npm run check`
locally, `exe/test` (a thin launcher for the same thing), and CI. `.github/workflows/ci.yml` runs it
on every PR; `.github/workflows/deploy.yml` runs the identical gate before publishing from `main` —
so passing locally means CI passes too. It runs each step with a clear name, streams the step's
output, and prints a pass/fail summary:

Steps run in three concurrent lanes — `app` (lint→typecheck→vitest), `core` (fmt→clippy→cargo
test→verify), and `e2e` — so the wall-clock is ~the slowest lane, not the sum (locally and in CI).

```
npm run check                 # the full gate (lanes run concurrently)
npm run check -- --serial     # one step at a time, grouped output (easier to read)
npm run check -- bake-out     # also self-check baked-level artifacts in ./bake-out
npm run check -- --skip=e2e   # drop steps by id
```

| Step | What it checks |
| --- | --- |
| eslint | app + scripts lint (type-aware flat config) |
| typescript | strict `tsc --noEmit` typecheck |
| vitest | app, store, live generation + wasm adapter (drives the committed `.wasm`), with V8 coverage |
| rustfmt | `cargo fmt --check` — the core crate must be formatted |
| clippy | `cargo clippy --all-targets -- -D warnings` |
| cargo test | engine, solver, generator + frozen golden-vector replays |
| verify | baked levels: golden winning lines + static invariants — **only** when a bake output dir is present (`npm run check -- bake-out`); skipped otherwise |
| playwright | e2e critical-path smokes against a production build — **only** when a Chromium is installed (CI installs one; skipped otherwise) |

The gameplay rules live only in the Rust core: `cargo test` covers rule correctness (crate unit
tests + the frozen golden vectors in `vectors/`), and the vitest suite drives the committed
`.wasm` for everything rule-shaped, including the freshness guard. Coverage is reported and held to
a loose floor (well below current, so only a real regression fails). Two steps are conditional on
their inputs: `verify`
re-checks emitted level artifacts (runs after a bake), and `playwright` drives the app in a real
browser (runs when a Chromium is present — always in CI).

Two **freshness guards** run inside the vitest/bake steps and fail loudly if a committed artifact
goes stale against the crate sources: `coreVersion.test.ts` (the committed `.wasm` was built from
the current crate) and `baked.test.ts` (the baked levels were generated by the current core). If
you change the crate, rebuild the affected artifact — `npm run core:wasm` and/or
`npm run build:levels`.

## Tooling

| Command | Does |
| --- | --- |
| `npm run dev` / `build` / `preview` | Vite dev server / production build / preview |
| `npm run check` | the full gate (`scripts/gate.ts`) |
| `npm test` / `test:watch` / `test:coverage` | Vitest (run-once / watch / +coverage) |
| `npm run test:e2e` / `test:e2e:ui` | Playwright browser smokes (headless / debug UI) |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run core:test` | `cargo test` (the Rust core crate) |
| `npm run core:lint` / `core:fmt` | `cargo clippy -D warnings` / `cargo fmt --check` |
| `npm run core:build` | `cargo build --release` (native binaries) |
| `npm run core:wasm` | rebuild the committed wasm package with `wasm-pack` and re-stamp it |
| `npm run build:levels` | bake the campaign natively → `levels.data.ts` (+ provenance, archive) |
| `npm run bench` | generation benchmark |

### The Rust core

Changing anything under `core/` needs a Rust toolchain (stable) with the `clippy` and `rustfmt`
components, plus [`wasm-pack`](https://rustwasm.github.io/wasm-pack/) for the wasm build:

```bash
rustup component add clippy rustfmt
cargo install wasm-pack          # or: brew install wasm-pack

npm run core:test                # run the crate's tests
npm run core:wasm                # rebuild src/game/core-pkg (commit the result)
npm run build:levels             # re-bake the campaign (commit levels.data.ts + meta)
```

The crate exposes two native binaries: `bake` (writes the campaign to JSON, consumed by
`scripts/emit-baked-from-rust.ts`) and `verify` (the artifact self-check the gate runs). The
`release` profile uses LTO for the long-running bake.

## Deployment (GitHub Pages)

Pushing to `main` triggers [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which
sets up Node **and a Rust toolchain (clippy + rustfmt, cached)**, runs the full gate
(`npm run check`), builds, and publishes `dist/` to GitHub Pages. The build uses the committed
wasm core and baked levels, so CI does not rebuild the wasm or re-bake.

One-time setup:

1. Create the `magic-color` repo on GitHub and push this branch.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The app goes live at `https://<user>.github.io/magic-color/`.

Vite's `base` is **relative (`./`)**, so the same build works at the Pages subpath *and* at a
root custom domain — no config change when switching.

### Custom domain (`magic-color.ostberg.dev`) — when ready

1. **DNS** (at your provider for `ostberg.dev`): add a `CNAME` record
   `magic-color` → `<user>.github.io`.
2. Add a `public/CNAME` file containing `magic-color.ostberg.dev`, then commit + push
   (Vite copies it to `dist/CNAME`). Equivalently, set it in **Settings → Pages → Custom domain**.
3. Once the cert is provisioned, tick **Enforce HTTPS**.

Do this *after* the default URL works — adding the custom domain makes the `.github.io` URL
redirect to it, which only resolves once DNS is live. The PWA needs no rebuild for the move
because all paths are relative.

> **PWA install note:** the service worker (offline support) only registers over HTTPS, which
> both the `.github.io` URL and the custom domain provide. Install on iOS via Safari → Share →
> **Add to Home Screen** while online once; it then runs fully offline.
