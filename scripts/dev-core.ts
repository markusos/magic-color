/**
 * Watch the Rust core (`core/src`) and rebuild the committed wasm on every change — closing the one
 * manual step in the core edit loop. Normally, after touching `core/src` you must remember to run
 * `npm run core:wasm` to re-stamp `src/game/core-pkg`, and the freshness guard (`coreVersion.test.ts`)
 * fails if you forget. Run this alongside `npm run dev` and each save reflects in the app after the
 * rebuild.
 *
 * Deliberately dependency-free (no `cargo-watch`): a recursive `fs.watch` + a small debounce that
 * re-runs the existing `npm run core:wasm` script. This is an INTERACTIVE dev loop, not a check, so
 * it is not a gate step — but it lives under `scripts/`, so it's linted and typechecked like the
 * rest of the tooling.
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';

const coreSrc = fileURLToPath(new URL('../core/src', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Ensure cargo/wasm-pack are reachable even from a shell that hasn't sourced the rustup env
// (mirrors exe/levels and the gate).
const home = process.env.HOME ?? '';
const env = { ...process.env, PATH: `${home}/.cargo/bin:${process.env.PATH ?? ''}` };

let building = false;
let queued = false;
let debounce: NodeJS.Timeout | undefined;

/** Rebuild the wasm. Coalesces overlapping requests: a change mid-build queues exactly one rerun. */
function rebuild(): void {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  console.log('\n[dev:core] rebuilding wasm (npm run core:wasm)…');
  const child = spawn(npm, ['run', 'core:wasm'], {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    building = false;
    console.log(
      code === 0
        ? '[dev:core] wasm up to date — watching core/src…'
        : `[dev:core] build failed (exit ${code ?? 'signal'}) — watching core/src…`,
    );
    if (queued) {
      queued = false;
      rebuild();
    }
  });
}

/** Debounce a burst of saves into a single rebuild. */
function schedule(): void {
  clearTimeout(debounce);
  debounce = setTimeout(rebuild, 150);
}

console.log('[dev:core] watching core/src (Ctrl-C to stop). Building once now to sync the wasm…');
try {
  watch(coreSrc, { recursive: true }, (_event, filename) => {
    // Only `.rs` edits change the rules; ignore editor scratch files and non-source churn.
    if (filename && filename.toString().endsWith('.rs')) schedule();
  });
} catch (err) {
  console.error(
    `[dev:core] could not start a recursive watch on ${coreSrc}: ${err instanceof Error ? err.message : String(err)}`,
  );
  console.error(
    '[dev:core] recursive fs.watch needs Node ≥ 20.13 on Linux. Run `npm run core:wasm` manually.',
  );
  process.exit(1);
}
// Sync once on startup so the wasm matches the current core even if it was edited before watching.
rebuild();
