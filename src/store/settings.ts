/**
 * The player's feedback preferences (sound-effects volume, music volume, haptics), persisted to
 * localStorage under their own key — separate from campaign `progress` so the two never collide. The
 * store is the source of truth and pushes each value into the audio/haptics modules (which self-gate on
 * it), so the rest of the app only ever calls `feedback(cue)` (or just plays music) without consulting
 * preferences.
 *
 * Defaults: sound effects up, haptics ON where supported, music at 0 (off — opt-in, so it never
 * surprises a player; PLAN.md A1). Volumes are in [0,1]. Storage is wrapped so private-mode / full /
 * disabled storage degrades to in-memory defaults rather than throwing. Older saves used boolean
 * `sound`/`music` toggles; {@link load} migrates those into volumes so a preference is never lost.
 */
import { create } from 'zustand';
import { playSound, setSoundVolume } from '../audio/sound';
import { setHapticsEnabled, vibrate } from '../audio/haptics';
import { setMusicVolume } from '../audio/music';

const KEY = 'magic-color:settings:v1';

/** Default level for sound effects when nothing is persisted. */
const DEFAULT_SOUND = 0.8;

interface Persisted {
  /** Sound-effects volume (the per-tap cues), 0–1. */
  soundVolume: number;
  /** Background-music volume (the ambient loop), 0–1; 0 = off. */
  musicVolume: number;
  haptics: boolean;
}

function defaults(): Persisted {
  return { soundVolume: DEFAULT_SOUND, musicVolume: 0, haptics: true };
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * A persisted value, migrating the legacy boolean toggle if present: a numeric volume is used as-is,
 * else an old `on` boolean maps to `whenOn`/0, else the default.
 */
function readVolume(volume: unknown, legacyOn: unknown, whenOn: number, fallback: number): number {
  if (typeof volume === 'number') return clamp01(volume);
  if (typeof legacyOn === 'boolean') return legacyOn ? whenOn : 0;
  return fallback;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      soundVolume: readVolume(p.soundVolume, p.sound, DEFAULT_SOUND, DEFAULT_SOUND),
      // Music stays opt-in: a legacy `music: true` carries over at a modest level, everything else off.
      musicVolume: readVolume(p.musicVolume, p.music, 0.6, 0),
      haptics: typeof p.haptics === 'boolean' ? p.haptics : true,
    };
  } catch {
    return defaults();
  }
}

function save(p: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable — preferences just won't survive a reload.
  }
}

interface SettingsStore extends Persisted {
  setSoundVolume: (v: number) => void;
  setMusicVolume: (v: number) => void;
  toggleHaptics: () => void;
}

/** The persisted subset of the store (drops the action functions). */
const persistedOf = (s: SettingsStore): Persisted => ({
  soundVolume: s.soundVolume,
  musicVolume: s.musicVolume,
  haptics: s.haptics,
});

export const useSettings = create<SettingsStore>((set, get) => {
  // Sync the persisted values into the feedback modules at startup (before any cue can fire).
  const initial = load();
  setSoundVolume(initial.soundVolume);
  setHapticsEnabled(initial.haptics);
  setMusicVolume(initial.musicVolume);

  return {
    ...initial,
    setSoundVolume: (v) => {
      const soundVolume = clamp01(v);
      setSoundVolume(soundVolume);
      set({ soundVolume });
      save(persistedOf(get()));
    },
    setMusicVolume: (v) => {
      const musicVolume = clamp01(v);
      setMusicVolume(musicVolume); // dragging the slider is the gesture that lets the context start
      set({ musicVolume });
      save(persistedOf(get()));
    },
    toggleHaptics: () => {
      const haptics = !get().haptics;
      setHapticsEnabled(haptics);
      set({ haptics });
      save(persistedOf(get()));
      if (haptics) vibrate('select');
    },
  };
});

/** Play a short cue at the current SFX volume, so the player can hear the level they've set. */
export function previewSound(): void {
  playSound('pour');
}
