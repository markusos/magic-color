/**
 * Bake the campaign levels — the shared module behind both `exe/levels` and `npm run build:levels`
 * (mirroring how `exe/test` / `npm run check` share `scripts/check.ts`).
 *
 * The pipeline is DETERMINISTIC: the native bake is fully seeded (`seed_for_level`) and run with the
 * committed default parameters, so with an unchanged core it reproduces the EXACT committed levels —
 * `src/game/levels.data.ts` byte-for-byte (the emit step prints the byte-match; a diff there means a
 * core rule changed). Steps run fail-fast, in order:
 *
 *   1. build the native bake binary (release — favors runtime; the bake is a long batch job)
 *   2. run it into ./bake-out (levels.json + provenance.json + golden-lines.json)
 *   3. emit the committed modules from that output (levels.data.ts / levels.meta.ts / provenance json)
 *   4. emit the dev-only levels.provenance.ts module
 *   5. archive the provenance sidecar into the per-build-hash history
 *
 * Kept identical to the former `build:levels` npm chain so the output is unchanged.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Project-local `tsx` binary, so the emit steps run regardless of how this module was launched. */
const tsx = fileURLToPath(
  new URL(`../node_modules/.bin/tsx${process.platform === 'win32' ? '.cmd' : ''}`, import.meta.url),
);

interface Step {
  name: string;
  cmd: string;
  args: string[];
}

const steps: Step[] = [
  { name: 'build bake binary (release)', cmd: 'cargo', args: ['build', '--release'] },
  { name: 'bake → ./bake-out', cmd: './target/release/bake', args: ['--out', 'bake-out'] },
  { name: 'emit levels.data.ts + meta + provenance.json', cmd: tsx, args: ['scripts/emit-baked-from-rust.ts', 'bake-out'] },
  { name: 'emit levels.provenance.ts', cmd: tsx, args: ['scripts/emit-provenance.ts'] },
  { name: 'archive provenance report', cmd: tsx, args: ['scripts/archive-report.ts'] },
];

// Ensure cargo is reachable even from a shell that hasn't sourced the rustup env (matches the gate).
const home = process.env.HOME ?? '';
const env = { ...process.env, PATH: `${home}/.cargo/bin:${process.env.PATH ?? ''}` };

console.log('== baking levels ==');
for (const [i, step] of steps.entries()) {
  console.log(`\n──────── ${i + 1}/${steps.length}  ${step.name} ────────`);
  const result = spawnSync(step.cmd, step.args, { stdio: 'inherit', env });
  if (result.status !== 0 || result.error) {
    console.error(`\n== BAKE FAILED at step ${i + 1} (${step.name}) ==`);
    process.exit(result.status ?? 1);
  }
}
console.log('\n== levels baked ==  (git diff src/game/levels.data.ts should be empty if the core is unchanged)');
