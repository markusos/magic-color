import { describe, it, expect } from 'vitest';
import { useSettings } from './settings';

const KEY = 'magic-color:settings:v1';

/** The persisted values currently in storage, or null. */
function persisted(): { soundVolume?: number; musicVolume?: number; haptics?: boolean } | null {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as { soundVolume?: number; musicVolume?: number; haptics?: boolean }) : null;
}

describe('settings store', () => {
  it('defaults sound up, haptics on, and music off (0)', () => {
    const { soundVolume, musicVolume, haptics } = useSettings.getState();
    expect(soundVolume).toBeGreaterThan(0);
    expect(haptics).toBe(true);
    expect(musicVolume).toBe(0);
  });

  it('sets music volume and round-trips it to localStorage (only the persisted keys)', () => {
    useSettings.getState().setMusicVolume(0.4);
    expect(useSettings.getState().musicVolume).toBeCloseTo(0.4);
    expect(persisted()?.musicVolume).toBeCloseTo(0.4);
    expect(Object.keys(persisted() ?? {}).sort()).toEqual(['haptics', 'musicVolume', 'soundVolume']);
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
