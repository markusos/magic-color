/**
 * Start the local dev server (Vite) with hot-module reloading — the shared module behind both
 * `exe/run` and `npm run dev`, mirroring how `exe/test` / `npm run check` share `scripts/check.ts`.
 *
 * Deliberately thin: it launches Vite's dev server and forwards any extra CLI args straight through
 * (e.g. `exe/run --port 3000 --host`), so it behaves exactly like invoking `vite` while keeping one
 * shared entry point. The committed wasm core (src/game/core-pkg) is already in the tree, so the dev
 * server needs no prior build.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve the project-local Vite binary so this works whether launched via npm, npx, or directly.
const bin = fileURLToPath(
  new URL(`../node_modules/.bin/vite${process.platform === 'win32' ? '.cmd' : ''}`, import.meta.url),
);

const child = spawn(bin, process.argv.slice(2), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

// Mirror the dev server's exit (Ctrl-C reaches it via the shared terminal process group).
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error(`failed to start vite: ${err.message}`);
  process.exit(1);
});
