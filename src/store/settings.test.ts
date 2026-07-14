import { describe, it, expect } from 'vitest';
import { useSettings } from './settings';

const KEY = 'magic-color:settings:v1';

/** The persisted values currently in storage, or null. */
function persisted(): Record<string, unknown> | null {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe('settings store', () => {
  it('defaults sound up, haptics on, music off (0), patterns off', () => {
    const { soundVolume, musicVolume, haptics, patterns } = useSettings.getState();
    expect(soundVolume).toBeGreaterThan(0);
    expect(haptics).toBe(true);
    expect(musicVolume).toBe(0);
    expect(patterns).toBe(false);
  });

  it('toggles color patterns and round-trips the flag', () => {
    expect(useSettings.getState().patterns).toBe(false);
    useSettings.getState().togglePatterns();
    expect(useSettings.getState().patterns).toBe(true);
    expect(persisted()?.patterns).toBe(true);
    useSettings.getState().togglePatterns();
    expect(useSettings.getState().patterns).toBe(false);
  });

  it('retires the patterns nudge when dismissed, and when the setting is toggled', () => {
    // The store is a singleton shared across tests, so start from a known "not yet nudged" state.
    useSettings.setState({ patternsNudged: false });
    useSettings.getState().dismissPatternsNudge();
    expect(useSettings.getState().patternsNudged).toBe(true);
    expect(persisted()?.patternsNudged).toBe(true);

    // Toggling the setting also retires the nudge (the player has discovered it).
    useSettings.setState({ patternsNudged: false });
    useSettings.getState().togglePatterns();
    expect(useSettings.getState().patternsNudged).toBe(true);
    useSettings.getState().togglePatterns(); // restore patterns off
  });

  it('records seen chapter intros idempotently and round-trips them', () => {
    const start = useSettings.getState().seenChapters.length;
    useSettings.getState().markChapterSeen(1);
    useSettings.getState().markChapterSeen(1); // idempotent — no duplicate
    expect(useSettings.getState().seenChapters.filter((c) => c === 1)).toEqual([1]);
    expect(persisted()?.seenChapters).toContain(1);
    useSettings.getState().markChapterSeen(2);
    expect(useSettings.getState().seenChapters.length).toBe(start + 2);
  });

  it('sets music volume and round-trips it to localStorage (only the persisted keys)', () => {
    useSettings.getState().setMusicVolume(0.4);
    expect(useSettings.getState().musicVolume).toBeCloseTo(0.4);
    expect(persisted()?.musicVolume).toBeCloseTo(0.4);
    expect(Object.keys(persisted() ?? {}).sort()).toEqual([
      'haptics',
      'inspector',
      'musicVolume',
      'patterns',
      'patternsNudged',
      'seenChapters',
      'soundVolume',
    ]);
    useSettings.getState().setMusicVolume(0); // restore default
    expect(useSettings.getState().musicVolume).toBe(0);
  });

  it('clamps volumes to the [0,1] range', () => {
    useSettings.getState().setSoundVolume(5);
    expect(useSettings.getState().soundVolume).toBe(1);
    useSettings.getState().setSoundVolume(-2);
    expect(useSettings.getState().soundVolume).toBe(0);
    useSettings.getState().setSoundVolume(0.8); // restore default
  });

  it('toggles haptics independently of the volumes', () => {
    const soundVolume = useSettings.getState().soundVolume;
    const haptics = useSettings.getState().haptics;
    useSettings.getState().toggleHaptics();
    expect(useSettings.getState().haptics).toBe(!haptics);
    expect(useSettings.getState().soundVolume).toBe(soundVolume); // unchanged
    useSettings.getState().toggleHaptics();
  });

  it('debug cheats are ephemeral and cleared when the inspector is disabled', () => {
    useSettings.setState({ inspector: true, revealHidden: false, freePour: false });
    useSettings.getState().toggleRevealHidden();
    useSettings.getState().toggleFreePour();
    expect(useSettings.getState().revealHidden).toBe(true);
    expect(useSettings.getState().freePour).toBe(true);
    // Cheats are NOT persisted.
    expect(persisted()).not.toHaveProperty('revealHidden');
    expect(persisted()).not.toHaveProperty('freePour');

    // Turning the inspector off clears both cheats (no lingering cheat with no way to disable it).
    useSettings.getState().toggleInspector();
    expect(useSettings.getState().inspector).toBe(false);
    expect(useSettings.getState().revealHidden).toBe(false);
    expect(useSettings.getState().freePour).toBe(false);
  });
});
