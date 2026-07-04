/**
 * Source hash of the Rust core crate — the G5 freshness guard's shared computation (Track F3).
 * Mirrors `levelVersion.ts`: hash every crate source that affects the wasm's behavior; the
 * `core:wasm` build stamps it into the committed package (`emit-core-stamp.ts`), and
 * `coreVersion.test.ts` fails when the crate changed without a rebuild — the committed `.wasm`
 * can never silently go stale against the rules.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every `.rs` under core/src (recursive, sorted) plus the manifest. */
function crateSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.rs')) files.push(path);
    }
  };
  walk(join(ROOT, 'core/src'));
  files.sort();
  files.push(join(ROOT, 'core/Cargo.toml'));
  return files;
}

export function currentCoreVersion(): string {
  const hash = createHash('sha256');
  for (const file of crateSources()) hash.update(readFileSync(file));
  return hash.digest('hex').slice(0, 16);
}
