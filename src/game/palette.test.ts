import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PALETTE, DEFAULT_CAPACITY } from './palette';
import { COLOR_VALUES, PATTERN_FOR, cssColor, patternFor } from '../theme/colors';

/**
 * These are CONTRACT tests, not behavior tests: the palette id list is a shared constant that must
 * stay byte-identical across three sources — `game/palette.ts` (the runtime), `theme/colors.ts`
 * (the CSS/pattern lookups), and Rust `core/src/types.rs::PALETTE` (which encodes a color as its
 * INDEX here across the wasm boundary; gate G5's shared-constants contract). A drift is otherwise
 * silent: a color missing from COLOR_VALUES ships as gray (`cssColor`'s '#888' fallback), and a
 * reordered/short Rust PALETTE mis-decodes every board the wasm hands back.
 */

describe('PALETTE self-consistency', () => {
  it('has no duplicate ids', () => {
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });

  it('has a CSS value for every id (no silent gray fallback)', () => {
    for (const id of PALETTE) {
      expect(COLOR_VALUES, `COLOR_VALUES missing "${id}"`).toHaveProperty(id);
      // Guard against an entry that exists but is the fallback / empty.
      expect(cssColor(id)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(cssColor(id)).not.toBe('#888');
    }
  });

  it('has a colorblind pattern for every id', () => {
    for (const id of PALETTE) {
      expect(PATTERN_FOR, `PATTERN_FOR missing "${id}"`).toHaveProperty(id);
      expect(patternFor(id)).not.toBe('');
    }
  });

  it('defines no COLOR_VALUES / PATTERN_FOR entries for unknown ids', () => {
    const known = new Set<string>(PALETTE);
    for (const id of Object.keys(COLOR_VALUES)) expect(known, `stray COLOR_VALUES "${id}"`).toContain(id);
    for (const id of Object.keys(PATTERN_FOR)) expect(known, `stray PATTERN_FOR "${id}"`).toContain(id);
  });
});

describe('cssColor / patternFor fallbacks', () => {
  it('returns the mapped value for a known id', () => {
    expect(cssColor('ruby')).toBe(COLOR_VALUES.ruby);
  });

  it('falls back to neutral gray for an unknown id', () => {
    expect(cssColor('not-a-color')).toBe('#888');
  });

  it('returns an empty pattern for an unknown id', () => {
    expect(patternFor('not-a-color')).toBe('');
  });
});

/**
 * Parse the two shared constants straight out of the Rust source. Reading the source (rather than
 * running the crate) keeps this a fast TS-only test while still failing loudly the moment the two
 * languages drift — exactly when a rebuild of the wasm would start mis-decoding colors.
 */
function readRustTypes(): string {
  // vitest runs from the project root, so the crate source is a stable relative path.
  return readFileSync(resolve(process.cwd(), 'core/src/types.rs'), 'utf8');
}

function rustPalette(src: string): string[] {
  const block = src.match(/pub const PALETTE:\s*\[&str;\s*\d+\]\s*=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error('could not locate `pub const PALETTE` in core/src/types.rs');
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe('TS ⇔ Rust shared-constants contract (core/src/types.rs)', () => {
  it('PALETTE matches the Rust core, in exact order', () => {
    expect(rustPalette(readRustTypes())).toEqual([...PALETTE]);
  });

  it('DEFAULT_CAPACITY matches the Rust core', () => {
    const m = readRustTypes().match(/pub const DEFAULT_CAPACITY:\s*u8\s*=\s*(\d+)/);
    expect(m, 'could not locate `pub const DEFAULT_CAPACITY` in core/src/types.rs').not.toBeNull();
    expect(Number(m![1])).toBe(DEFAULT_CAPACITY);
  });
});
