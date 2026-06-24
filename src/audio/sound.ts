/**
 * Synthesized sound cues — zero asset files. Each {@link Cue} is generated on the fly from the Web
 * Audio API (oscillator + gain envelope), which keeps the backendless static PWA asset-free and
 * licensing-free, and makes every tone a constant we can re-tune by feel (see PLAN.md A1).
 *
 * The `AudioContext` is created lazily and resumed on demand: browsers (iOS especially) only allow
 * audio to start inside a user gesture, and every `playSound` call originates from a tap/toggle
 * handler, so the resume always lands inside a gesture. In a non-browser/test environment (no
 * `AudioContext`) every entry point is a safe no-op.
 */
import type { Cue } from './cues';
import { getAudioContext } from './context';

/** One scheduled oscillator note, offset from the cue's start. */
interface Note {
  /** Start frequency (Hz). */
  freq: number;
  /** Seconds after the cue start to begin. */
  start: number;
  /** Duration (s). */
  dur: number;
  /** Peak gain (0–1), scaled by the master headroom. */
  gain: number;
  type?: OscillatorType;
  /** Optional exponential glide to this frequency over the note's life (a "shimmer"/"blip" sweep). */
  slideTo?: number;
}

/**
 * The cue → notes table. Short envelopes throughout so rapid pours don't smear into one another.
 * Tunable by design: these are the only numbers to touch when re-balancing the palette by feel.
 */
const CUES: Record<Cue, Note[]> = {
  // A soft high pick-up tick.
  select: [{ freq: 620, start: 0, dur: 0.05, gain: 0.5, type: 'sine' }],
  // A softer, lower put-down tick.
  deselect: [{ freq: 380, start: 0, dur: 0.05, gain: 0.45, type: 'sine' }],
  // A low muted thud that falls — "can't do that".
  invalid: [{ freq: 150, start: 0, dur: 0.12, gain: 0.6, type: 'triangle', slideTo: 90 }],
  // A short pitched blip that rises as it pours.
  pour: [{ freq: 300, start: 0, dur: 0.1, gain: 0.5, type: 'triangle', slideTo: 360 }],
  // A bright two-note resolve (C5 → G5).
  cap: [
    { freq: 523, start: 0, dur: 0.08, gain: 0.5, type: 'sine' },
    { freq: 784, start: 0.07, dur: 0.13, gain: 0.5, type: 'sine' },
  ],
  // A short ascending arpeggio (C5–E5–G5–C6).
  win: [
    { freq: 523, start: 0, dur: 0.1, gain: 0.5, type: 'sine' },
    { freq: 659, start: 0.1, dur: 0.1, gain: 0.5, type: 'sine' },
    { freq: 784, start: 0.2, dur: 0.1, gain: 0.5, type: 'sine' },
    { freq: 1047, start: 0.3, dur: 0.24, gain: 0.55, type: 'sine' },
  ],
  // A bright upward shimmer (two gliding partials).
  thaw: [
    { freq: 880, start: 0, dur: 0.3, gain: 0.4, type: 'sine', slideTo: 1760 },
    { freq: 1320, start: 0.05, dur: 0.26, gain: 0.22, type: 'sine', slideTo: 2200 },
  ],
};

/** Global headroom so a multi-note cue can't clip; keeps the palette comfortably quiet. */
const MASTER_GAIN = 0.16;
/** Floor for exponential ramps (which can't target 0). */
const EPS = 0.0001;

/** SFX volume in [0,1] (player-set); the bus gain is this scaled by the master headroom. */
let soundVolume = 1;
let master: GainNode | null = null;

/** The SFX bus (a gain node), created once on the shared context and kept at the current volume. */
function ensureMaster(ctx: AudioContext): GainNode {
  if (!master) {
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  master.gain.value = MASTER_GAIN * soundVolume;
  return master;
}

/** Schedule one note relative to `t0` (the cue's start time), optionally pitch-scaled by `pitch`. */
function schedule(c: AudioContext, out: GainNode, note: Note, t0: number, pitch = 1): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = note.type ?? 'sine';
  const start = t0 + note.start;
  const end = start + note.dur;
  osc.frequency.setValueAtTime(note.freq * pitch, start);
  if (note.slideTo) osc.frequency.exponentialRampToValueAtTime(note.slideTo * pitch, end);
  // Quick attack, exponential decay to (near) silence — a soft percussive envelope.
  g.gain.setValueAtTime(EPS, start);
  g.gain.exponentialRampToValueAtTime(note.gain, start + Math.min(0.01, note.dur * 0.3));
  g.gain.exponentialRampToValueAtTime(EPS, end);
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** Set the SFX volume in [0,1] (driven by the Settings slider); 0 = muted. */
export function setSoundVolume(volume: number): void {
  soundVolume = Math.max(0, Math.min(1, volume));
  if (master) master.gain.value = MASTER_GAIN * soundVolume;
}

/**
 * Play a cue, unless muted (volume 0) or Web Audio is unavailable. `level` (0–1) only affects the
 * `pour` cue: its blip rises with how full the destination ends up — topping off a near-full tube
 * sounds higher than pouring into an empty one — up to ~+7 semitones.
 */
export function playSound(cue: Cue, level?: number): void {
  if (soundVolume <= 0) return;
  const c = getAudioContext();
  if (!c) return;
  const out = ensureMaster(c);
  const t0 = c.currentTime + 0.001;
  const pitch =
    cue === 'pour' && level != null ? 2 ** ((Math.max(0, Math.min(1, level)) * 7) / 12) : 1;
  for (const note of CUES[cue]) schedule(c, out, note, t0, pitch);
}
