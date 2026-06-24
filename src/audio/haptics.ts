/**
 * Haptic feedback via `navigator.vibrate` (Android / some desktop). iOS Safari ignores `vibrate`
 * entirely, so this is strictly best-effort and feature-detected — never assume it fires (PLAN.md A1).
 * Each {@link Cue} maps to a short pattern that mirrors the sound's shape.
 */
import type { Cue } from './cues';

/** Vibration pattern per cue: a single duration (ms) or an on/off pattern. Kept short and subtle. */
const PATTERNS: Record<Cue, number | number[]> = {
  select: 8,
  deselect: 6,
  invalid: [0, 18, 28, 18],
  pour: 10,
  cap: [0, 12, 16, 12],
  win: [0, 20, 40, 20, 40, 30],
  thaw: 14,
};

let hapticsEnabled = true;

/**
 * Whether haptics are actually meaningful here. Desktop Chrome/Firefox expose `navigator.vibrate` but
 * have no vibration motor (it's a silent no-op), so requiring the API isn't enough — we also require a
 * touch-primary device (`(hover: none) and (pointer: coarse)`, the same phone/tablet heuristic the
 * board CSS uses). This keeps the Haptics toggle off computers, where it would do nothing.
 */
export function hapticsSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** Enable/disable haptics (driven by the Settings store). */
export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
}

/** Fire the cue's vibration pattern, unless disabled or unsupported. */
export function vibrate(cue: Cue): void {
  if (!hapticsEnabled || !hapticsSupported()) return;
  try {
    navigator.vibrate(PATTERNS[cue]);
  } catch {
    // Some browsers throw on certain patterns / states — haptics are non-essential, so swallow it.
  }
}
