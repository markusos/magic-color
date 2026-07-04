/**
 * Gate G5 (Track F3): the committed wasm package can never go stale against the Rust crate.
 * `npm run core:wasm` stamps the crate-source hash it built from; this test recomputes the
 * hash over the live sources and fails on mismatch — i.e. someone edited `core/` without
 * rebuilding the committed `.wasm`. The exact analogue of `baked.test.ts`'s staleness guard.
 */
import { describe, expect, it } from 'vitest';
import { currentCoreVersion } from '../../scripts/coreVersion';
import { CORE_SOURCE_HASH } from './core-pkg/core.version';

describe('committed wasm freshness (G5)', () => {
  it('crate sources match the stamp the committed .wasm was built from', () => {
    expect(currentCoreVersion()).toBe(CORE_SOURCE_HASH);
  });
});
