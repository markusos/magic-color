import { describe, expect, it } from 'vitest';
import { getProvenance, loadProvenance } from './provenance';
import { LEVEL_PROVENANCE } from './levels.provenance';
import { BAKED_LEVEL_COUNT } from './levelLoader';

// Vitest runs with `import.meta.env.DEV === true`, so the dev-only provenance loader is active here.
describe('provenance', () => {
  it('emits one row per baked level, keyed by level', () => {
    expect(Object.keys(LEVEL_PROVENANCE)).toHaveLength(BAKED_LEVEL_COUNT);
    const first = LEVEL_PROVENANCE[1]!;
    expect(first.level).toBe(1);
    expect(typeof first.score).toBe('number');
    expect(typeof first.metrics.optimal).toBe('number');
  });

  it('loads the full map and returns a baked level row', async () => {
    const map = await loadProvenance();
    expect(map).not.toBeNull();
    expect(map!.size).toBe(BAKED_LEVEL_COUNT);

    const row = await getProvenance(1);
    expect(row).not.toBeNull();
    expect(row!.level).toBe(1);
    expect(row!.metrics.colors).toBeGreaterThan(0);
  });

  it('returns null for a level with no baked board', async () => {
    expect(await getProvenance(BAKED_LEVEL_COUNT + 5_000)).toBeNull();
  });
});
