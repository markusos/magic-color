/**
 * Staleness guard for the baked levels — repointed at the RUST CRATE since Track F5. The bake
 * lives in `core/` now, so `currentGeneratorVersion()` is the crate-source hash (shared with
 * the G5 wasm-freshness guard — one hash covers both committed artifacts): the build stamps it
 * into `levels.data.ts`/`levels.meta.ts`, and `baked.test.ts` fails if the committed stamp no
 * longer matches — i.e. someone changed the generator/curve/selection (in `core/`) without
 * re-running `npm run build:levels`. Cheap (a hash, no search), so it's safe in CI.
 *
 * The pre-F5 version hashed the JS bake sources; those were deleted with the JS core at
 * F5/F6, so the crate hash is the single source of truth for the committed boards.
 */
import { currentCoreVersion } from './coreVersion';

export function currentGeneratorVersion(): string {
  return currentCoreVersion();
}
