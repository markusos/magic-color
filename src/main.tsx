import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
