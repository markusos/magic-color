import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreen, navigate, type Screen } from './useHashRoute';

beforeEach(() => {
  // Start each spec from a clean hash so the route snapshot is deterministic.
  window.location.hash = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('navigate → hash', () => {
  it.each<[Screen, string]>([
    ['home', '#/'],
    ['play', '#/play'],
    ['settings', '#/settings'],
    ['levels', '#/levels'],
    ['stats', '#/stats'],
  ])('navigate(%s) sets the hash to %s', (screen, expected) => {
    navigate(screen);
    expect(window.location.hash).toBe(expected);
  });
});

describe('useScreen (hash → screen)', () => {
  it('defaults to home for an empty hash', () => {
    const { result } = renderHook(() => useScreen());
    expect(result.current).toBe('home');
  });

  it.each<[string, Screen]>([
    ['#/play', 'play'],
    ['#play', 'play'], // tolerant of a missing leading slash
    ['#/settings', 'settings'],
    ['#/levels', 'levels'],
    ['#/stats', 'stats'],
    ['#/', 'home'],
    ['#/unknown', 'home'], // any unrecognized path falls back to home
  ])('maps %s → %s', (hash, screen) => {
    const { result } = renderHook(() => useScreen());
    act(() => {
      window.location.hash = hash;
      // Setting location.hash fires hashchange asynchronously; dispatch it (as the browser does,
      // just synchronously here) so the hook re-reads its snapshot within this act().
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(result.current).toBe(screen);
  });

  it('re-renders when navigate() changes the route', () => {
    const { result } = renderHook(() => useScreen());
    expect(result.current).toBe('home');
    act(() => navigate('levels'));
    expect(result.current).toBe('levels');
    act(() => navigate('home'));
    expect(result.current).toBe('home');
  });
});

describe('navigate dispatches hashchange synchronously', () => {
  it('fires a hashchange event in the same tick (before the async native one)', () => {
    const onChange = vi.fn();
    window.addEventListener('hashchange', onChange);
    try {
      navigate('play');
      // The synchronous dispatch is load-bearing: it lets the new screen (and its spinner) render
      // in the same commit as the state change that triggered navigation, rather than waiting for
      // the browser's queued hashchange task. So the listener must have fired already.
      expect(onChange).toHaveBeenCalled();
    } finally {
      window.removeEventListener('hashchange', onChange);
    }
  });
});
