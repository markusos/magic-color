/**
 * Archive the just-baked provenance sidecar (`scripts/levels.provenance.json`) into a per-build-hash
 * history folder (`scripts/build-history/<version>.json`), so every distinct bake config is retained
 * for A/B comparison in the report app instead of being overwritten. The file name is the generator
 * version hash (`currentGeneratorVersion()`, also stored inside the JSON), which changes exactly when a
 * SOURCES file that affects the boards changes — so one archived report per meaningfully-different bake.
 *
 * Kept SEPARATE from `build-levels.ts` for the same reason as `emit-provenance.ts`: that file is in the
 * `levelVersion.ts` staleness hash, so adding an output write there would force a full re-bake. This
 * step only reads the sidecar the bake already wrote. Wired after the bake in `build:levels`, and
 * runnable alone via `npm run levels:archive`.
 *
 * Idempotent: if an archive for this hash already exists it is left untouched, preserving the original
 * `archivedAt` timestamp (a re-bake with unchanged sources is byte-identical, so there's nothing new to
 * record). Pass `--force` to overwrite anyway.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'scripts/build-history');
const force = process.argv.includes('--force');
// `--from <path>` archives an external provenance file — e.g. a Rust bake's scratch output
// (Track F2), whose `version` is the crate-source hash — instead of the JS bake sidecar.
const fromIdx = process.argv.indexOf('--from');
const SRC =
  fromIdx !== -1 && process.argv[fromIdx + 1]
    ? process.argv[fromIdx + 1]!
    : join(ROOT, 'scripts/levels.provenance.json');

const json = JSON.parse(readFileSync(SRC, 'utf8')) as { version?: string; levels: unknown[] };
const version = json.version;
if (!version) {
  console.error('No `version` in scripts/levels.provenance.json — re-run `npm run build:levels`.');
  process.exit(1);
}

mkdirSync(DIR, { recursive: true });
const out = join(DIR, `${version}.json`);

if (existsSync(out) && !force) {
  console.log(`Build ${version} already archived (${json.levels.length} levels) — leaving it untouched.`);
} else {
  // Stamp when this build was first archived, so the report can order builds chronologically. Preserved
  // across idempotent re-runs (we only reach here on a new hash or --force).
  const archived = { ...json, archivedAt: new Date().toISOString() };
  writeFileSync(out, JSON.stringify(archived, null, 2) + '\n');
  console.log(
    `Archived build ${version} (${json.levels.length} levels) → scripts/build-history/${version}.json`,
  );
}
