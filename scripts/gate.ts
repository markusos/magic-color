/**
 * The project's quality gate — as a reusable TypeScript module so the SAME orchestration runs
 * locally (`exe/test` / `npm run check`) and in CI (`.github/workflows/ci.yml`). One definition of
 * "what green means" for both sides of the codebase (the TypeScript app AND the Rust core crate),
 * so a passing local run and a passing CI run mean exactly the same thing.
 *
 * Each step streams its own output under a header; a per-step summary prints at the end and the
 * process exits non-zero if any step failed. When running under GitHub Actions the headers become
 * collapsible `::group::` blocks and failures emit `::error::` annotations. The gameplay rules live
 * ONLY in the Rust core: `cargo test` replays the frozen golden vectors (vectors/*.json) alongside
 * the crate's unit tests, and the vitest suite drives the committed .wasm for everything
 * rule-shaped plus the freshness guards. The Playwright step drives the built app in a real browser.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

export type StepStatus = 'pass' | 'fail' | 'skip';

/** A single external command in a step (argv form — no shell, so no quoting pitfalls). */
export interface Command {
  cmd: string;
  args: string[];
}

/** One gate step: a name, an optional guard that can skip it, and the commands it runs in order. */
export interface StepDef {
  /** Stable short id (used by `--skip`). */
  id: string;
  /** Human label shown in headers and the summary. */
  label: string;
  /** Return a reason to SKIP (green), or null to run. Evaluated at run time. */
  skip?: (ctx: GateContext) => string | null;
  /** The commands to run, computed at run time (so freshness checks see prior steps' effects). */
  commands: (ctx: GateContext) => Command[];
}

export interface GateContext {
  /** Directory that may hold baked-level artifacts for the `verify` self-check. */
  bakeDir: string;
  /** Where Playwright's browsers live; the `e2e` step is skipped when none is found here. */
  browsersPath: string;
  /** Step ids the caller asked to skip (e.g. to split CI into parallel jobs). */
  skipIds: Set<string>;
  /** True under GitHub Actions — switches headers to `::group::` and failures to `::error::`. */
  isCI: boolean;
  /** Environment for child processes (cargo is ensured on PATH). */
  env: NodeJS.ProcessEnv;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmRun = (script: string): Command => ({ cmd: npm, args: ['run', script] });

/** The compiled `verify` binary the baked-level self-check invokes. */
const VERIFY_BIN = './target/release/verify';

/** Locate the newest pre-installed Chromium under `browsersPath` (empty string if none). */
function findChromium(browsersPath: string): string {
  if (!existsSync(browsersPath)) return '';
  // Sort by the numeric revision, NOT lexicographically: string order puts "chromium-999" after
  // "chromium-1005", which would pick an older build once revisions cross a digit-count boundary.
  const revs = readdirSync(browsersPath)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(a.slice('chromium-'.length)) - Number(b.slice('chromium-'.length)));
  for (const rev of revs.reverse()) {
    const bin = `${browsersPath}/${rev}/chrome-linux/chrome`;
    if (existsSync(bin)) return bin;
  }
  return '';
}

/** The ordered gate steps. Kept as data so CI can introspect/select them, not just run them. */
export function gateSteps(): StepDef[] {
  return [
    // ---- TypeScript app ----
    { id: 'lint', label: 'eslint — lint app + scripts', commands: () => [npmRun('lint')] },
    { id: 'typecheck', label: 'typescript — strict typecheck', commands: () => [npmRun('typecheck')] },
    {
      id: 'test',
      label: 'vitest — app, store, live generation + wasm adapter (drives the committed .wasm), with coverage',
      commands: () => [npmRun('test:coverage')],
    },
    // ---- Rust core crate ----
    { id: 'fmt', label: 'rustfmt — core crate formatting', commands: () => [npmRun('core:fmt')] },
    { id: 'clippy', label: 'clippy — core crate lints', commands: () => [npmRun('core:lint')] },
    {
      id: 'core-test',
      label: 'cargo test — engine, solver, generator + frozen golden-vector replays',
      commands: () => [npmRun('core:test')],
    },
    // ---- Baked-level self-check (only when artifacts are present) ----
    {
      id: 'verify',
      label: 'verify — baked levels: golden winning lines + static invariants',
      skip: (ctx) =>
        existsSync(`${ctx.bakeDir}/levels.json`)
          ? null
          : `no artifacts at ${ctx.bakeDir} — produce them with: npm run build:levels`,
      commands: (ctx) => {
        const cmds: Command[] = [];
        // Build the verify binary on demand if it isn't already there.
        if (!existsSync(VERIFY_BIN)) {
          cmds.push({ cmd: 'cargo', args: ['build', '--release', '--bin', 'verify'] });
        }
        cmds.push({ cmd: VERIFY_BIN, args: [ctx.bakeDir] });
        return cmds;
      },
    },
    // ---- Browser-only E2E (only when a Chromium is available) ----
    {
      id: 'e2e',
      label: 'playwright — e2e critical-path smokes (real browser)',
      skip: (ctx) =>
        findChromium(ctx.browsersPath)
          ? null
          : `no Chromium under ${ctx.browsersPath} — install with: npx playwright install chromium`,
      commands: () => [npmRun('test:e2e')],
    },
  ];
}

/** Build a context from argv + env. Positional arg = bake dir; `--skip=a,b` drops steps by id. */
export function resolveContext(argv: string[]): GateContext {
  const skipIds = new Set<string>();
  let bakeDir = 'bake-out';
  for (const arg of argv) {
    if (arg.startsWith('--skip=')) {
      for (const id of arg.slice('--skip='.length).split(',')) if (id) skipIds.add(id);
    } else if (!arg.startsWith('-')) {
      bakeDir = arg;
    }
  }
  const home = process.env.HOME ?? '';
  return {
    bakeDir,
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers',
    skipIds,
    isCI: process.env.GITHUB_ACTIONS === 'true',
    // Ensure cargo is reachable even from a login shell that hasn't sourced the rustup env.
    env: { ...process.env, PATH: `${home}/.cargo/bin:${process.env.PATH ?? ''}` },
  };
}

function openHeader(label: string, isCI: boolean): void {
  if (isCI) console.log(`::group::${label}`);
  else console.log(`\n──────── ${label} ────────`);
}

function closeHeader(isCI: boolean): void {
  if (isCI) console.log('::endgroup::');
}

/** Run the gate. Returns the process exit code (0 = all steps PASS/SKIP, 1 = a step FAILED). */
export function runGate(ctx: GateContext): number {
  console.log('== quality gate ==');
  const summary: string[] = [];
  let failed = false;

  for (const step of gateSteps()) {
    if (ctx.skipIds.has(step.id)) {
      summary.push(`SKIP  ${step.label} (--skip=${step.id})`);
      continue;
    }
    const reason = step.skip?.(ctx) ?? null;
    openHeader(step.label, ctx.isCI);
    if (reason) {
      console.log(`SKIP (${reason})`);
      summary.push(`SKIP  ${step.label} (${reason})`);
      closeHeader(ctx.isCI);
      continue;
    }

    let ok = true;
    for (const c of step.commands(ctx)) {
      const result = spawnSync(c.cmd, c.args, { stdio: 'inherit', env: ctx.env });
      if (result.status !== 0 || result.error) {
        ok = false;
        break;
      }
    }
    closeHeader(ctx.isCI);

    if (ok) {
      summary.push(`PASS  ${step.label}`);
    } else {
      summary.push(`FAIL  ${step.label}`);
      failed = true;
      if (ctx.isCI) console.log(`::error::gate step failed: ${step.label}`);
    }
  }

  console.log('\n== summary ==');
  for (const line of summary) console.log(`  ${line}`);
  console.log(failed ? '== GATE: FAIL ==' : '== GATE: PASS ==');
  return failed ? 1 : 0;
}
