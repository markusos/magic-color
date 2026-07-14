/**
 * The project's quality gate — as a reusable TypeScript module so the SAME orchestration runs
 * locally (`exe/test` / `npm run check`) and in CI (`.github/workflows/ci.yml`). One definition of
 * "what green means" for both sides of the codebase (the TypeScript app AND the Rust core crate),
 * so a passing local run and a passing CI run mean exactly the same thing.
 *
 * Steps are grouped into independent LANES (`app`, `core`, `e2e`) that run CONCURRENTLY; steps
 * within a lane run in order. The lanes are genuinely independent — the TS app checks, the Rust
 * crate checks, and the browser e2e don't share inputs — so the wall-clock is ~max(lane) instead of
 * the sum, both locally and in CI (one command, one runner, no duplicated setup). `--serial` forces
 * one-at-a-time execution with cleaner grouped output for debugging. A per-step summary prints at
 * the end and the process exits non-zero if any step failed.
 *
 * The gameplay rules live ONLY in the Rust core: `cargo test` replays the frozen golden vectors
 * (vectors/*.json) alongside the crate's unit tests, and the vitest suite drives the committed .wasm
 * for everything rule-shaped plus the freshness guards. The Playwright step drives the built app in
 * a real browser.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

export type StepStatus = 'pass' | 'fail' | 'skip';

/** Concurrency groups. Lanes run in parallel; steps within a lane run in order. */
export type Lane = 'app' | 'core' | 'e2e';

/** A single external command in a step (argv form — no shell, so no quoting pitfalls). */
export interface Command {
  cmd: string;
  args: string[];
}

/** One gate step: a name, its lane, an optional guard that can skip it, and the commands it runs. */
export interface StepDef {
  /** Stable short id (used by `--skip`). */
  id: string;
  /** Human label shown in headers and the summary. */
  label: string;
  /** Which concurrency lane this step belongs to. */
  lane: Lane;
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
  /** Step ids the caller asked to skip (`--skip=a,b`). */
  skipIds: Set<string>;
  /** Run lanes one at a time with grouped output instead of concurrently with prefixed output. */
  serial: boolean;
  /** True under GitHub Actions — switches serial headers to `::group::` and failures to `::error::`. */
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

/**
 * The ordered gate steps, tagged with their lane. Kept as data so CI can introspect/select them.
 * Lanes: `app` (TS: lint→typecheck→vitest), `core` (Rust: fmt→clippy→cargo test→verify), `e2e`
 * (browser). `verify` sits in `core` so its `cargo build` can't run concurrently with `cargo test`
 * and contend on the `target/` lock.
 */
export function gateSteps(): StepDef[] {
  return [
    // ---- app lane: TypeScript ----
    { id: 'lint', lane: 'app', label: 'eslint — lint app + scripts', commands: () => [npmRun('lint')] },
    { id: 'typecheck', lane: 'app', label: 'typescript — strict typecheck', commands: () => [npmRun('typecheck')] },
    {
      id: 'test',
      lane: 'app',
      label: 'vitest — app, store, live generation + wasm adapter (drives the committed .wasm), with coverage',
      commands: () => [npmRun('test:coverage')],
    },
    // ---- core lane: Rust crate ----
    { id: 'fmt', lane: 'core', label: 'rustfmt — core crate formatting', commands: () => [npmRun('core:fmt')] },
    { id: 'clippy', lane: 'core', label: 'clippy — core crate lints', commands: () => [npmRun('core:lint')] },
    {
      id: 'core-test',
      lane: 'core',
      label: 'cargo test — engine, solver, generator + frozen golden-vector replays',
      commands: () => [npmRun('core:test')],
    },
    {
      id: 'verify',
      lane: 'core',
      label: 'verify — baked levels: golden winning lines + static invariants',
      skip: (ctx) =>
        existsSync(`${ctx.bakeDir}/levels.json`)
          ? null
          : `no artifacts at ${ctx.bakeDir} — produce them with: npm run build:levels`,
      commands: (ctx) => {
        const cmds: Command[] = [];
        if (!existsSync(VERIFY_BIN)) {
          cmds.push({ cmd: 'cargo', args: ['build', '--release', '--bin', 'verify'] });
        }
        cmds.push({ cmd: VERIFY_BIN, args: [ctx.bakeDir] });
        return cmds;
      },
    },
    // ---- e2e lane: browser ----
    {
      id: 'e2e',
      lane: 'e2e',
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
  let serial = false;
  for (const arg of argv) {
    if (arg === '--serial') serial = true;
    else if (arg.startsWith('--skip=')) {
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
    serial,
    isCI: process.env.GITHUB_ACTIONS === 'true',
    // Ensure cargo is reachable even from a login shell that hasn't sourced the rustup env.
    env: { ...process.env, PATH: `${home}/.cargo/bin:${process.env.PATH ?? ''}` },
  };
}

/** Outcome of running one step, keyed for the end-of-run summary (printed in gateSteps() order). */
interface StepOutcome {
  status: StepStatus;
  /** Skip reason or `--skip`, for the summary line. */
  note?: string;
}

/** Run one command, streaming each output line through `onLine`. Resolves true on exit code 0. */
function runCommand(c: Command, env: NodeJS.ProcessEnv, onLine: (line: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(c.cmd, c.args, { env });
    const pump = (stream: NodeJS.ReadableStream) => {
      let buf = '';
      stream.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) onLine(line);
      });
      stream.on('end', () => {
        if (buf) onLine(buf);
      });
    };
    pump(child.stdout);
    pump(child.stderr);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/** Run one step (its command sequence), reporting output via `onLine`. */
async function runStep(step: StepDef, ctx: GateContext, onLine: (line: string) => void): Promise<StepOutcome> {
  if (ctx.skipIds.has(step.id)) return { status: 'skip', note: `--skip=${step.id}` };
  const reason = step.skip?.(ctx) ?? null;
  if (reason) {
    onLine(`SKIP (${reason})`);
    return { status: 'skip', note: reason };
  }
  for (const c of step.commands(ctx)) {
    if (!(await runCommand(c, ctx.env, onLine))) return { status: 'fail' };
  }
  return { status: 'pass' };
}

/** Run one lane's steps in order, prefixing every output line with the lane tag. */
async function runLaneParallel(
  lane: Lane,
  steps: StepDef[],
  ctx: GateContext,
  outcomes: Map<string, StepOutcome>,
): Promise<void> {
  const tag = `[${lane}]`.padEnd(6);
  for (const step of steps) {
    console.log(`${tag} ┌─ ${step.label}`);
    const outcome = await runStep(step, ctx, (line) => console.log(`${tag} │ ${line}`));
    outcomes.set(step.id, outcome);
    console.log(`${tag} └─ ${outcome.status.toUpperCase()}`);
  }
}

/** Run one step with serial (grouped) output — used by `--serial`. */
async function runStepSerial(step: StepDef, ctx: GateContext, outcomes: Map<string, StepOutcome>): Promise<void> {
  if (ctx.isCI) console.log(`::group::${step.label}`);
  else console.log(`\n──────── ${step.label} ────────`);
  const outcome = await runStep(step, ctx, (line) => console.log(line));
  outcomes.set(step.id, outcome);
  if (ctx.isCI) console.log('::endgroup::');
}

/** Run the gate. Returns the process exit code (0 = all steps PASS/SKIP, 1 = a step FAILED). */
export async function runGate(ctx: GateContext): Promise<number> {
  console.log(`== quality gate ==${ctx.serial ? ' (serial)' : ' (lanes: app | core | e2e)'}`);
  const steps = gateSteps();
  const outcomes = new Map<string, StepOutcome>();

  if (ctx.serial) {
    for (const step of steps) await runStepSerial(step, ctx, outcomes);
  } else {
    const lanes = [...new Set(steps.map((s) => s.lane))];
    await Promise.all(
      lanes.map((lane) => runLaneParallel(lane, steps.filter((s) => s.lane === lane), ctx, outcomes)),
    );
  }

  // Summary in declaration order, regardless of which lane finished first.
  let failed = false;
  console.log('\n== summary ==');
  for (const step of steps) {
    const outcome = outcomes.get(step.id) ?? { status: 'fail' as StepStatus };
    const suffix = outcome.note ? ` (${outcome.note})` : '';
    console.log(`  ${outcome.status.toUpperCase().padEnd(4)}  ${step.label}${suffix}`);
    if (outcome.status === 'fail') {
      failed = true;
      if (ctx.isCI) console.log(`::error::gate step failed: ${step.label}`);
    }
  }
  console.log(failed ? '== GATE: FAIL ==' : '== GATE: PASS ==');
  return failed ? 1 : 0;
}
