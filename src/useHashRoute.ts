/**
 * Minimal hash router — no dependency. Maps `window.location.hash` to a named screen and
 * keeps it in sync across back/forward navigation. Hash routing (rather than a `screen` flag)
 * gives the PWA a working Back button/gesture and makes screens deep-linkable, all while
 * working fully offline.
 */
import { useSyncExternalStore } from 'react';

export type Screen = 'home' | 'play' | 'settings' | 'levels';

function parse(hash: string): Screen {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'play') return 'play';
  if (path === 'settings') return 'settings';
  if (path === 'levels') return 'levels';
  return 'home';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The current screen, re-rendering on hash changes. */
export function useScreen(): Screen {
  return useSyncExternalStore(
    subscribe,
    () => parse(window.location.hash),
    () => 'home',
  );
}

/** Navigate to a screen by setting the hash (adds a history entry, so Back works). */
export function navigate(screen: Screen): void {
  window.location.hash = screen === 'home' ? '/' : `/${screen}`;
}
