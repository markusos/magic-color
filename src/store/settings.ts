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
  /** Colorblind aid: fill each color with a distinct texture/pattern. Off by default. */
  patterns: boolean;
  /** Debug (Track E1): overlay the active board's difficulty metrics. Hidden behind the admin hatch, off by default. */
  inspector: boolean;
}

// Track F5 note: the F3/F4 `wasmCore` A/B flag was removed with the JS core it toggled — the
// Rust core is the only solver/generator now (a stale persisted key is simply ignored).

function defaults(): Persisted {
  return { soundVolume: DEFAULT_SOUND, musicVolume: 0, haptics: true, patterns: false, inspector: false };
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
      patterns: typeof p.patterns === 'boolean' ? p.patterns : false,
      inspector: typeof p.inspector === 'boolean' ? p.inspector : false,
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
  /**
   * Ephemeral (NOT persisted) view state for the debug inspector popover: whether it's currently open.
   * Distinct from `inspector` (the persisted enable flag) — the popover behaves like the how-to-play
   * one: the ⓘ button opens it, a tap on the backdrop (or ⓘ again) closes it. Starts closed.
   */
  inspectorOpen: boolean;
  /**
   * Ephemeral debug cheats, toggled from the inspector popover and gated by it (so they require the admin
   * hatch). Not persisted — they reset each session and are cleared when the inspector is disabled, so a
   * cheat never lingers. `revealHidden` draws concealed cells face-up (render-only); `freePour` lets any
   * top run pour onto any tube with room, ignoring colour/funnel/ice rules (read by the store's tap path).
   */
  revealHidden: boolean;
  freePour: boolean;
  setSoundVolume: (v: number) => void;
  setMusicVolume: (v: number) => void;
  toggleHaptics: () => void;
  togglePatterns: () => void;
  toggleInspector: () => void;
  /** Expand/collapse the inspector overlay without disabling it (the ⓘ button + the panel's ✕). */
  toggleInspectorOpen: () => void;
  toggleRevealHidden: () => void;
  toggleFreePour: () => void;
}

/** The persisted subset of the store (drops the action functions). */
const persistedOf = (s: SettingsStore): Persisted => ({
  soundVolume: s.soundVolume,
  musicVolume: s.musicVolume,
  haptics: s.haptics,
  patterns: s.patterns,
  inspector: s.inspector,
});

export const useSettings = create<SettingsStore>((set, get) => {
  // Sync the persisted values into the feedback modules at startup (before any cue can fire).
  const initial = load();
  setSoundVolume(initial.soundVolume);
  setHapticsEnabled(initial.haptics);
  setMusicVolume(initial.musicVolume);

  return {
    ...initial,
    // The inspector popover starts closed (opened on demand via the ⓘ button); ephemeral, not saved.
    inspectorOpen: false,
    // Debug cheats start off and never persist.
    revealHidden: false,
    freePour: false,
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
    togglePatterns: () => {
      // Purely a render-layer flag (read by LiquidSegment/Bottle) — no audio module to notify.
      const patterns = !get().patterns;
      set({ patterns });
      save(persistedOf(get()));
    },
    toggleInspector: () => {
      // Debug inspector enable flag (read by the ⓘ button). Toggling it always leaves the popover
      // closed — it's opened on demand from the header, like how-to-play. Disabling it also clears the
      // debug cheats so neither lingers without a way (the popover) to turn it back off.
      const inspector = !get().inspector;
      set(inspector ? { inspector, inspectorOpen: false } : { inspector, inspectorOpen: false, revealHidden: false, freePour: false });
      save(persistedOf(get())); // inspectorOpen + the cheats are ephemeral, excluded from persistedOf
    },
    toggleInspectorOpen: () => set({ inspectorOpen: !get().inspectorOpen }),
    toggleRevealHidden: () => set({ revealHidden: !get().revealHidden }),
    toggleFreePour: () => set({ freePour: !get().freePour }),
  };
});

/** Play a short cue at the current SFX volume, so the player can hear the level they've set. */
export function previewSound(): void {
  playSound('pour');
}
