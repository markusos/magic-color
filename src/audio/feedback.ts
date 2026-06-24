/**
 * The single entry point gameplay uses to render a {@link Cue}: play its sound AND fire its haptic.
 * The store calls `feedback(cue)` once per tap outcome; each underlying layer self-gates on its own
 * enabled flag (set by the Settings store), so a thin one-line call site stays decoupled from the
 * user's preferences.
 */
import type { Cue } from './cues';
import { playSound } from './sound';
import { vibrate } from './haptics';

/**
 * Render a cue across every feedback channel (sound + haptics). `level` (0–1) is an optional intensity
 * passed through to the sound — currently the `pour` cue's pitch, which rises with the destination fill.
 */
export function feedback(cue: Cue, level?: number): void {
  playSound(cue, level);
  vibrate(cue);
}

export type { Cue };
