/**
 * Full dev loop under one command: the Vite dev server AND the wasm watcher (`dev:core`), for when
 * you're editing the Rust core and the app together. `exe/run` / `npm run dev` stay the fast,
 * toolchain-free frontend loop (just Vite, no build); this additionally rebuilds the committed wasm
 * on every `core/src` change, so it needs cargo + wasm-pack (`exe/dev` puts cargo on PATH).
 *
 * A thin supervisor: it spawns both as direct children (so they share this process group and a
 * terminal Ctrl-C reaches the whole tree), and if EITHER exits it tears down the other — you never
 * end up with a half-running loop (e.g. a stray Vite holding the port after the watcher crashes).
 * Extra CLI args pass through to Vite, matching `exe/run` (`exe/dev --port 3000`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';

/** Resolve a project-local binary (Vite, tsx) so this works via npm, npx, or a direct call. */
const binPath = (name: string): string =>
  fileURLToPath(new URL(`../node_modules/.bin/${name}${isWin ? '.cmd' : ''}`, import.meta.url));

const viteArgs = process.argv.slice(2);
const devCoreScript = fileURLToPath(new URL('./dev-core.ts', import.meta.url));

const children: { name: string; child: ChildProcess }[] = [];
let shuttingDown = false;

/** Stop every child and exit. Idempotent — the first caller (a signal or a child exit) wins. */
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) child.kill('SIGTERM');
  process.exit(code);
}

/** Spawn one long-lived child; its unexpected exit tears down the whole loop. */
function start(name: string, cmd: string, args: string[]): void {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: isWin });
  children.push({ name, child });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`\n[dev] ${name} stopped (${signal ?? code ?? 0}) — stopping the rest…`);
    shutdown(typeof code === 'number' ? code : 0);
  });
  child.on('error', (err) => {
    console.error(`[dev] failed to start ${name}: ${err.message}`);
    shutdown(1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting Vite dev server + wasm watcher (Ctrl-C stops both)…');
start('vite', binPath('vite'), viteArgs);
start('dev:core', binPath('tsx'), [devCoreScript]);
