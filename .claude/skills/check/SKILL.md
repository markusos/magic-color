---
name: check
description: Run this project's quality gate — lint, typecheck, and tests. Use before committing, after editing source, or when asked to verify/check/test the code or confirm changes are safe.
---

# Running checks for magic-color

The quality gate covers both sides of the codebase — the TypeScript app and the Rust `core`
crate. It mirrors what CI (`.github/workflows/deploy.yml`) runs on every push to `main`, so
passing it locally means CI will pass too.

## The full gate (one command before committing)

```bash
npm run check       # → exe/test — the whole gate, JS + Rust, with per-step progress
```

`npm run check` runs `exe/test`, which is exactly what CI runs. It streams each step's output
under a header and prints a pass/fail summary at the end:

```
eslint — lint app + scripts
typescript — strict typecheck
vitest — app, store, live generation + wasm adapter (drives the committed .wasm)
rustfmt — core crate formatting
clippy — core crate lints
cargo test — engine, solver, generator + frozen golden-vector replays
verify — baked levels: golden winning lines + static invariants   (only when bake output exists)
```

The gameplay rules live only in the Rust core: `cargo test` covers rule correctness (crate unit
tests + the frozen golden vectors in `vectors/`), while the vitest suite drives the committed
`.wasm` for everything rule-shaped and includes the freshness guards. The `verify` step is the one
thing beyond CI: it self-checks emitted level artifacts and runs only when a bake output directory
is present (`exe/test bake-out`, produced by `npm run build:levels`). All steps must be clean.
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
| Watch tests while editing | `npm run test:watch` |
| One test file | `npx vitest run src/game/solver.test.ts` |
| Tests matching a name | `npx vitest run -t "deadlock"` |
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
