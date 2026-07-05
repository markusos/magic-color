/**
 * The shared color palette and standard capacity — the runtime home since Track F5 (these
 * lived in `generator.ts`, which is now a test-only oracle outside the app graph). Palette
 * ORDER is load-bearing: the wasm boundary encodes a color as its index here, and the Rust
 * core's `types::PALETTE` must match exactly (gate G5's shared-constants contract).
 */
import { toColor, type Color } from './types';

/** Palette ids (see ../theme/colors.ts for CSS values). Generation uses the first N. */
export const PALETTE: readonly Color[] = [
  'ruby',
  'amethyst',
  'sapphire',
  'emerald',
  'amber',
  'rose',
  'teal',
  'violet',
  'lime',
  'tangerine',
  'cobalt',
  'magenta',
].map(toColor);

/** Max segments a bottle holds in the standard game. */
export const DEFAULT_CAPACITY = 4;
