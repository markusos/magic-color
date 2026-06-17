---
name: check
description: Run this project's quality gate — lint, typecheck, and tests. Use before committing, after editing source, or when asked to verify/check/test the code or confirm changes are safe.
---

# Running checks for magic-color

This project has three quality gates. They mirror what CI (`.github/workflows/deploy.yml`)
runs on every push to `main`, so passing them locally means CI will pass too.

## The full gate (run all three before committing)

```bash
npm run lint        # ESLint (flat config, type-aware) — see eslint.config.js
npx tsc --noEmit    # TypeScript strict typecheck (same as the build's tsc step)
npm test            # Vitest, run-once (vitest run)
```

All three must be clean. `npm run build` also runs `tsc --noEmit` first, so a green
typecheck means the build's type step will pass.

## Individual commands

| Goal | Command |
| --- | --- |
| Lint everything | `npm run lint` |
| Lint + auto-fix | `npx eslint . --fix` |
| Lint one file | `npx eslint src/game/solver.ts` |
| Typecheck | `npx tsc --noEmit` |
| All tests once | `npm test` |
| Watch tests while editing | `npm run test:watch` |
| One test file | `npx vitest run src/game/solver.test.ts` |
| Tests matching a name | `npx vitest run -t "deadlock"` |
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
