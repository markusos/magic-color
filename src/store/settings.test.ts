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

  it('sets music volume and round-trips it to localStorage (only the persisted keys)', () => {
    useSettings.getState().setMusicVolume(0.4);
    expect(useSettings.getState().musicVolume).toBeCloseTo(0.4);
    expect(persisted()?.musicVolume).toBeCloseTo(0.4);
    expect(Object.keys(persisted() ?? {}).sort()).toEqual([
      'haptics',
      'inspector',
      'musicVolume',
      'patterns',
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
});
