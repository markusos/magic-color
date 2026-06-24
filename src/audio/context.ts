/**
 * The single lazily-created Web Audio `AudioContext`, shared by the SFX synth (`sound.ts`) and the
 * generative music loop (`music.ts`) so they mix into one graph instead of spinning up two contexts.
 *
 * Browsers (iOS especially) start the context suspended and only allow audio inside a user gesture;
 * every caller reaches this from a tap/toggle handler, so the `resume()` here lands inside a gesture.
 * Returns null where Web Audio is unavailable (SSR / tests), making every audio entry point a safe
 * no-op there.
 */
let ctx: AudioContext | null = null;

/** The shared AudioContext (created on first use and resumed), or null if Web Audio is unavailable. */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
