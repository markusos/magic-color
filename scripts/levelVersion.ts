/**
 * Staleness guard for the baked levels. `currentGeneratorVersion()` hashes the source files that
 * determine what boards the bake produces; the build script stamps this into `levels.data.ts`, and a
 * test (`baked.test.ts`) fails if the committed stamp no longer matches — i.e. someone changed the
 * generator/curve/selection without re-running `npm run build:levels`. Cheap (a hash, no search), so
 * it's safe in CI.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source files whose contents affect the baked board set. Keep in sync with what the bake reads. */
const SOURCES = [
  'src/game/generator.ts',
  'src/game/progression.ts',
  'src/game/hidden.ts',
  'src/game/difficulty.ts',
  'src/game/search.ts',
  'src/game/solver.ts',
  'src/game/engine.ts',
  'scripts/build-levels.ts',
];

export function currentGeneratorVersion(): string {
  const hash = createHash('sha256');
  for (const rel of SOURCES) hash.update(readFileSync(join(ROOT, rel)));
  return hash.digest('hex').slice(0, 16);
}
