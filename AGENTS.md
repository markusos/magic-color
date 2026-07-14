# AGENTS.md

Guidance for coding agents working in **magic-color** — a color-sorting puzzle PWA (React + TypeScript
front end, a Rust `core/` crate that owns all gameplay rules, compiled to wasm). Keep changes small and
run the gate before committing.

## Everyday commands

Three `exe/` scripts are thin bash launchers over shared TypeScript modules (`scripts/*.ts`); each has a
matching `npm run` alias that invokes the exact same module, so use whichever you prefer.

| Do this | Command | Notes |
| --- | --- | --- |
| Run the quality gate | `exe/test` (or `npm run check`) | The full gate — **run before every commit.** |
| Start the dev server | `exe/run` (or `npm run dev`) | Vite + hot reload at http://localhost:5173. Args pass through (`exe/run --port 3000`). |
| Auto-rebuild wasm on core edits | `npm run dev:core` | Watches `core/src`, re-runs `core:wasm` on each `.rs` save. Run alongside `npm run dev` when editing rules. |
| Re-bake the levels | `exe/levels` (or `npm run build:levels`) | Deterministic native bake → `levels.data.ts`. Slow (minutes) + all-cores. |
| Production build | `npm run build` | `tsc --noEmit && vite build` → `dist/`. |

Narrower loops: `npm test` / `npm run test:watch` / `npm run test:coverage` (vitest), `npm run test:e2e`
(Playwright), `npm run lint`, `npm run format` (Prettier, auto-fixes ts/tsx; the gate runs
`format:check`), `npm run typecheck`, `npm run core:test` (cargo).

## The quality gate (`exe/test` → `scripts/gate.ts`)

One gate runs both sides of the codebase, in three **concurrent lanes** (so wall-clock ≈ the slowest lane):

- **app** — prettier (format check) → eslint → typescript (app) → typescript (`scripts/` dev tooling) → vitest (with a coverage floor; see `vite.config.ts`)
- **core** — rustfmt → clippy → cargo test (crate unit tests + frozen golden-vector replays) → verify
- **e2e** — Playwright smokes against a production build (auto-skips if no Chromium is installed)

The *same* gate runs in CI (`.github/workflows/ci.yml` on PRs, `deploy.yml` before publishing), so a green
local run means green CI. Useful flags: `exe/test --serial` (one step at a time, cleaner logs),
`exe/test --skip=e2e` (drop steps by id), `exe/test bake-out` (also run the baked-level self-check).
See `.claude/skills/check/SKILL.md` for the full breakdown.

## Rules of the road (the non-obvious bits)

- **Gameplay rules live ONLY in the Rust core (`core/src/`).** The TS side reaches them through the
  committed wasm (`src/game/core-pkg/`) via `coreWasm.ts`. Adding or changing a mechanic is a `core/` change;
  the TS registry (`mechanics.ts`) only holds DISPLAY transforms. Don't reimplement rules in TS.
- **After changing `core/`**, rebuild the committed artifacts or the freshness guards fail:
  `npm run core:wasm` (re-stamps the wasm; guarded by `coreVersion.test.ts`) and, if you touched the
  generator/curve/selection, `exe/levels` (re-bake; guarded by `baked.test.ts`). `npm run dev:core`
  automates the `core:wasm` half — leave it running while you edit and it re-stamps on every save.
- **The bake is deterministic** — a no-op re-bake reproduces the committed levels byte-for-byte
  (`git diff src/game/levels.data.ts` stays empty). A diff there means a core rule actually changed.
- **Shared constants must stay in lockstep.** The palette id list and capacity exist in `src/game/palette.ts`,
  `src/theme/colors.ts`, and Rust `core/src/types.rs`; `src/game/palette.test.ts` enforces the match. Keep them equal.
- **TypeScript is strict** (`noUncheckedIndexedAccess`, `noUnusedLocals`, …) and **ESLint is type-aware** —
  fix the root cause rather than reaching for `!` or `eslint-disable`.
- **Tests live beside their source** as `*.test.ts(x)` and use vitest globals (no imports). Pure `src/game/*`
  logic has no DOM; component/store tests use jsdom + Testing Library and prefer accessible-name selectors
  (the app exposes aria-labels — no test ids). E2E specs live in `e2e/` and are run only by Playwright.
- `scripts/` ARE linted and typechecked — `npm run lint` covers them (type-aware, via
  `tsconfig.scripts.json`) and `npm run typecheck:scripts` is a gate step, so a type error in the
  gate itself is caught statically. `exe/` are thin bash launchers (not TypeScript); sanity-check
  those by running them.

## Layout

```
src/            React app (components/, store/, game/, theme/, audio/)  — game/core-pkg is generated wasm
core/           Rust crate: the rules (engine, solver, generator, difficulty, mechanics) + the bake binary
e2e/            Playwright browser smokes
scripts/        gate.ts (quality gate), run.ts (dev), levels.ts (bake), + bake-pipeline glue
exe/            thin launchers: test → scripts/check.ts, run → scripts/run.ts, levels → scripts/levels.ts
```

## Commits & PRs

Short, imperative, type-prefixed subjects (`test:`, `ci:`, `perf:`, `tooling:`, `fix:`). Don't commit
generated output that the gate can regenerate (`dist/`, `coverage/`, `bake-out/`, Playwright reports —
all gitignored). Open a PR only when asked; CI runs the same gate you ran locally.
