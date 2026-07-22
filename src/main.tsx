import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
// Side-effect import: attaches the `beforeinstallprompt` listener at startup, before the event can
// fire, no matter which route the app booted into (Home may not be mounted yet).
import './install/installState';
// Side-effect import: creates the settings store so its persisted Sound/Haptics flags are pushed into
// the audio/haptics modules before the first cue can fire (regardless of whether Settings is mounted).
import './store/settings';
import styles from './Boot.module.css';

// iOS standalone PWAs mis-measure 100dvh on launch (the layout comes up short until a
// scroll forces a reflow). Drive the app height from window.innerHeight instead, and keep
// it in sync as the viewport settles / rotates. Set before first paint to avoid a flash.
function syncAppHeight() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
syncAppHeight();
requestAnimationFrame(syncAppHeight);
(['resize', 'orientationchange', 'pageshow'] as const).forEach((event) =>
  window.addEventListener(event, syncAppHeight),
);

// iOS doesn't reliably match the `display-mode: standalone` media query, so detect the
// home-screen (standalone) launch in JS and tag <html> for the CSS to target.
const isStandalone =
  (window.navigator as { standalone?: boolean }).standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;
if (isStandalone) document.documentElement.classList.add('pwa-standalone');

/**
 * Boot fallback shown while the APP MODULE GRAPH loads. The app is imported dynamically below
 * because its graph blocks on real work — the baked-level chunk and the Rust core wasm are both
 * awaited at module top level (see levelLoader.ts) — and on a slow or stalled connection that
 * used to hang the page on the bare background gradient with no feedback at all. Phases:
 *
 *   quiet   — first ~600ms: render nothing, so a normal (service-worker-cached) boot never
 *             flashes a spinner;
 *   spinner — the graph is genuinely taking a moment;
 *   slow    — several seconds in (a weak connection): name the likely cause and offer Retry.
 *             The pending import is NOT abandoned — if it lands late, the app still takes over;
 *   failed  — the import rejected (e.g. offline on a first visit, before anything was cached):
 *             explain and offer Retry.
 */
type BootPhase = 'quiet' | 'spinner' | 'slow' | 'failed';

function Boot({ phase }: { phase: BootPhase }) {
  if (phase === 'quiet') return null;
  return (
    <div className={styles.boot} role="status" aria-live="polite">
      {phase !== 'failed' && <div className={styles.spinner} aria-hidden />}
      {phase === 'slow' && (
        <p className={styles.message}>Still loading — this can take a while on a weak connection.</p>
      )}
      {phase === 'failed' && (
        <p className={styles.message}>Couldn’t load the game. Check your connection and try again.</p>
      )}
      {(phase === 'slow' || phase === 'failed') && (
        <button className={styles.retry} onClick={() => window.location.reload()}>
          Retry
        </button>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);

let appMounted = false;
const showBoot = (phase: BootPhase) => {
  if (!appMounted) root.render(<Boot phase={phase} />);
};

showBoot('quiet');
const spinnerTimer = setTimeout(() => showBoot('spinner'), 600);
const slowTimer = setTimeout(() => showBoot('slow'), 8000);

import('./App')
  .then(({ default: App }) => {
    appMounted = true;
    clearTimeout(spinnerTimer);
    clearTimeout(slowTimer);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    clearTimeout(spinnerTimer);
    clearTimeout(slowTimer);
    console.error('[boot] app module graph failed to load', err);
    showBoot('failed');
  });
