---
name: check
description: Run this project's quality gate — lint, typecheck, and tests. Use before committing, after editing source, or when asked to verify/check/test the code or confirm changes are safe.
---

# Running checks for magic-color

The quality gate covers both sides of the codebase — the TypeScript app and the Rust `core`
crate. The orchestration lives in TypeScript (`scripts/gate.ts`, run via `scripts/check.ts`) so the
SAME steps run locally and in CI: `.github/workflows/ci.yml` runs `npm run check` on every PR, and
`.github/workflows/deploy.yml` runs the identical gate before publishing from `main`. Passing it
locally means CI will pass too.

## The full gate (one command before committing)

```bash
npm run check       # → tsx scripts/check.ts — the whole gate, JS + Rust + e2e, with per-step progress
```

`npm run check` runs the TypeScript orchestrator (`exe/test` is a thin shim that calls the same
thing). Steps run in three concurrent LANES (output is prefixed `[app]` / `[core]` / `[e2e]`), so
the wall-clock is ~the slowest lane rather than the sum. A per-step pass/fail summary prints at the
end. Add `--serial` for one-at-a-time, grouped output when a log is easier to read that way
(`npm run check -- --serial`).

```
app  — eslint → typescript → vitest (+coverage)
core — rustfmt → clippy → cargo test → verify (verify only when bake output exists)
e2e  — playwright critical-path smokes (only when a Chromium is installed)
```

The gameplay rules live only in the Rust core: `cargo test` covers rule correctness (crate unit
tests + the frozen golden vectors in `vectors/`), while the vitest suite drives the committed
`.wasm` for everything rule-shaped and includes the freshness guards (it runs with V8 coverage —
it enforces a LOOSE floor — set well below current coverage, so it fails only on a real regression,
not ±1% jitter). Two steps are conditional: `verify` self-checks emitted level artifacts
and runs only when a bake output directory is present (`npm run check -- bake-out`, produced by
`npm run build:levels`); `playwright` drives the built app in a real browser and runs only when a
Chromium is installed (CI installs one; locally it skips green if absent). Steps can be dropped by id
with `npm run check -- --skip=e2e`. All non-skipped steps must be clean.
`npm run build` also runs `tsc --noEmit` first, so a green typecheck means the build's type step
will pass.

## Individual commands

| Goal | Command |
| --- | --- |
| Full gate (JS + Rust) | `npm run check` |
| Lint everything | `npm run lint` |
| Lint + auto-fix | `npx eslint . --fix` |
| Lint one file | `npx eslint src/game/solver.ts` |
| Typecheck | `npm run typecheck` (or `npx tsc --noEmit`) |
| All tests once | `npm test` |
| Tests + coverage report | `npm run test:coverage` |
| Watch tests while editing | `npm run test:watch` |
| One test file | `npx vitest run src/game/solver.test.ts` |
| Tests matching a name | `npx vitest run -t "deadlock"` |
| E2E smokes (real browser) | `npm run test:e2e` (`npm run test:e2e:ui` to debug) |
| Rust: format check / auto-format | `npm run core:fmt` / `cargo fmt` |
| Rust: clippy lint | `npm run core:lint` |
| Rust: tests | `npm run core:test` (or `cargo test`) |
| One Rust test | `cargo test --test conformance` / `cargo test <name>` |
| Production build (typecheck + bundle) | `npm run build` |

## Conventions

- **TypeScript is strict** (`strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`). Indexed access is `T | undefined` — narrow with a guard rather
  than reaching for a `!` assertion; ESLint's `no-unnecessary-type-assertion` will flag
  assertions the compiler already proves redundant.
- **ESLint is type-aware** (`recommendedTypeChecked`). Prefer fixing the root cause over
  disabling a rule; only add an inline `eslint-disable` with a comment explaining why.
- **Tests live beside their source** as `*.test.ts(x)` and use Vitest globals
  (`describe`/`it`/`expect`) — no imports needed. The pure `src/game/*` modules have no
  DOM and should stay fast; component/store tests use jsdom + Testing Library.
- After changing any `src/game/*` logic, run the matching `*.test.ts` plus the full suite —
  the engine, solver, generator, and hidden mechanic are tightly coupled by shared rules.

## When something fails

- **Lint errors**: try `npx eslint . --fix` first (handles most formatting/assertion fixes),
  then re-read the remaining errors — they're usually real type-safety issues.
- **Typecheck errors but lint clean**: `tsc` checks the whole project graph; look at the
  exact file:line it reports.
- **Test failures**: run just the failing file with `npx vitest run <path>` to iterate, or
  `npm run test:watch` for a tight loop.
- **Rust fmt failures** (`core:fmt`): run `cargo fmt` to auto-format the crate, then re-check.
- **Rust clippy/test failures**: run `cargo clippy --all-targets` or `cargo test <name>`
  directly in the repo root — the `core` crate is the workspace member being checked.
