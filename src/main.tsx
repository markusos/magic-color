import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
// Side-effect import: attaches the `beforeinstallprompt` listener at startup, before the event can
// fire, no matter which route the app booted into (Home may not be mounted yet).
import './install/installState';
import App from './App';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
