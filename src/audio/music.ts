/**
 * Light background music — generated, not sampled, like every other sound in the game (PLAN.md A1:
 * zero asset files, no bundle weight, no licensing). A slow ambient pad cycles a gentle, consonant
 * chord progression with a sparse pentatonic melody on top, kept quiet so it sits under the SFX.
 *
 * It shares the one `AudioContext` (`context.ts`) on its own low-gain bus, so the music volume never
 * touches the SFX volume. Default OFF (volume 0); it only starts once volume > 0 AND a user gesture has
 * let the context run (browsers block audio otherwise) — if music is enabled before any gesture (e.g. a
 * returning player whose volume is up), it arms a one-time gesture listener and starts on the first
 * interaction. The bus gain tracks the slider live.
 */
import { getAudioContext } from './context';

/** Headroom at full slider — quiet, so music sits well under the effects. The bus = this × volume. */
const MUSIC_GAIN = 0.08;
/** Seconds per chord (very slow = ambient). */
const STEP_SECONDS = 3.6;
/** Base pitch (A3). */
const ROOT = 220;

/** Semitone offset of each chord's root across the loop — a calm i–VI–III–VII-ish wander. */
const PROGRESSION = [0, -3, 4, -5];
/** Voiced as an open, consonant triad (root, fifth, octave) — no thirds, so it never sounds busy. */
const CHORD = [0, 7, 12];
/** Major-pentatonic degrees (semitones) the melody picks from, an octave up. */
const PENTATONIC = [0, 2, 4, 7, 9];

/** Convert a semitone offset from ROOT into a frequency. */
const freqAt = (semitones: number): number => ROOT * 2 ** (semitones / 12);

/** Music volume in [0,1] (player-set); 0 = off. The bus target gain is this × {@link MUSIC_GAIN}. */
let musicVolume = 0;
let started = false;
let step = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let bus: GainNode | null = null;
let unlockArmed = false;

/** The bus gain to ramp toward at the current volume. */
const targetGain = (): number => Math.max(0.0001, MUSIC_GAIN * musicVolume);

/** The music bus (a low-gain node), created once on the shared context. */
function ensureBus(ctx: AudioContext): GainNode {
  if (!bus) {
    bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(ctx.destination);
  }
  return bus;
}

/** Schedule one soft voice (slow attack/release pad or melody note) onto the music bus. */
function voice(
  ctx: AudioContext,
  out: GainNode,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  type: OscillatorType,
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  const attack = dur * 0.35;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Schedule the current chord (sustained pad) + an occasional melody note, then advance the loop. */
function playStep(ctx: AudioContext): void {
  if (!bus) return;
  const t = ctx.currentTime + 0.05;
  const rootShift = PROGRESSION[step % PROGRESSION.length]!;
  // The pad: the open triad, overlapping the next step so chords blend (legato).
  for (const interval of CHORD) {
    voice(ctx, bus, freqAt(rootShift + interval), t, STEP_SECONDS * 1.25, 0.5, 'sine');
  }
  // A sparse melody note (most steps), an octave above, from the pentatonic scale.
  if (step % 2 === 0) {
    const degree = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)]!;
    voice(ctx, bus, freqAt(rootShift + 12 + degree), t + 0.2, STEP_SECONDS * 0.7, 0.32, 'triangle');
  }
  step++;
}

/** Ramp the bus toward the current volume's target gain over `seconds`. */
function rampBus(ctx: AudioContext, out: GainNode, seconds: number): void {
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), ctx.currentTime);
  out.gain.exponentialRampToValueAtTime(targetGain(), ctx.currentTime + seconds);
}

/** Begin the loop once the context is running, fading in to the current volume. */
function begin(ctx: AudioContext): void {
  if (started) return;
  started = true;
  rampBus(ctx, ensureBus(ctx), 1.5); // fade in so music doesn't pop on
  playStep(ctx);
  timer = setInterval(() => playStep(ctx), STEP_SECONDS * 1000);
}

/** Arm a one-time gesture listener that retries start() — for music turned up before any user gesture. */
function armUnlock(): void {
  if (unlockArmed || typeof window === 'undefined') return;
  unlockArmed = true;
  const handler = () => {
    window.removeEventListener('pointerdown', handler);
    unlockArmed = false;
    if (musicVolume > 0) start();
  };
  window.addEventListener('pointerdown', handler, { once: true });
}

/** Try to start the music: needs volume > 0, a context, and a running (gesture-unlocked) context. */
function start(): void {
  if (started || musicVolume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'running') {
    begin(ctx);
    return;
  }
  // Suspended: resume() only works inside a gesture; resolve there, otherwise wait for the next tap.
  void ctx.resume().then(() => {
    if (musicVolume > 0 && ctx.state === 'running') begin(ctx);
  });
  armUnlock();
}

/** Stop the loop and fade the bus to silence. */
function stop(): void {
  started = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const ctx = getAudioContext();
  if (bus && ctx) {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
  }
}

/**
 * Set the music volume in [0,1] (driven by the Settings slider). Above 0 starts the loop (or, if
 * already playing, slews the bus to the new level); 0 stops it. Starting needs a user gesture to let
 * the audio context run — see {@link armUnlock}.
 */
export function setMusicVolume(volume: number): void {
  musicVolume = Math.max(0, Math.min(1, volume));
  if (musicVolume <= 0) {
    stop();
    return;
  }
  if (!started) {
    start();
    return;
  }
  const ctx = getAudioContext();
  if (ctx && bus) rampBus(ctx, bus, 0.3); // live volume change while playing
}
