import { useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { previewSound, useSettings } from '../../store/settings';
import { hapticsSupported } from '../../audio/haptics';
import { navigate } from '../../useHashRoute';
import { useInstall } from '../../install/useInstall';
import { BAKED_LEVEL_COUNT } from '../../game/levelLoader';
import { GENERATOR_VERSION } from '../../game/levels.meta';
import { InstallInstructions } from '../InstallBanner/InstallInstructions';
import { AdminPanel } from './AdminPanel';
import { ToggleRow } from './ToggleRow';
import styles from './Settings.module.css';

/**
 * A labeled volume slider row (0–100%). The filled portion of the track is drawn with an inline
 * gradient driven by the value (native range tracks aren't fill-styleable cross-browser). `onCommit`
 * fires when the drag/keypress ends — used to play a preview cue so the player hears the level.
 */
function SliderRow({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        aria-label={label}
        aria-valuetext={`${pct}%`}
        className={styles.range}
        style={{
          background: `linear-gradient(90deg, var(--accent) ${pct}%, rgba(255,255,255,0.18) ${pct}%)`,
        }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}

/** Number of rapid title taps that reveals the hidden admin panel. */
const ADMIN_TAP_COUNT = 7;
/** Taps must land within this window (ms) of each other to count toward the streak. */
const ADMIN_TAP_WINDOW = 600;

/**
 * Settings screen: the player's feedback and accessibility preferences, plus app-level actions
 * ("Start Over").
 *
 * It also owns the reveal gesture for the hidden admin panel — which is intentionally
 * undiscoverable: it appears only after tapping the "Settings" title {@link ADMIN_TAP_COUNT} times
 * in quick succession (the classic "tap to enable developer mode" gesture). There is no visible
 * affordance, so ordinary players never stumble into it. The panel's own contents live in
 * {@link AdminPanel} — this screen only decides whether to show it.
 */
export function Settings() {
  const furthest = useGameStore((s) => s.furthest);
  const startOver = useGameStore((s) => s.startOver);
  const soundVolume = useSettings((s) => s.soundVolume);
  const musicVolume = useSettings((s) => s.musicVolume);
  const haptics = useSettings((s) => s.haptics);
  const patterns = useSettings((s) => s.patterns);
  const setSoundVolume = useSettings((s) => s.setSoundVolume);
  const setMusicVolume = useSettings((s) => s.setMusicVolume);
  const toggleHaptics = useSettings((s) => s.toggleHaptics);
  const togglePatterns = useSettings((s) => s.togglePatterns);
  // Surface the same install affordance as the home banner, but always (no dismissal) when the app
  // isn't already installed and the platform can offer it.
  const { platform, install } = useInstall();
  // "Progress" means the unlock frontier, not the level being actively played (you may be
  // replaying an earlier one). Nothing to reset only when the frontier is still level 1.
  const fresh = furthest <= 1;

  const [adminOpen, setAdminOpen] = useState(false);
  const tapCount = useRef(0);
  const lastTap = useRef(0);

  const onStartOver = () => {
    if (window.confirm('Start over from level 1? Your progress will be erased.')) {
      startOver();
      navigate('play');
    }
  };

  // Count rapid taps on the title; once the streak hits the threshold, reveal the admin panel.
  const onTitleTap = () => {
    const now = Date.now();
    tapCount.current = now - lastTap.current < ADMIN_TAP_WINDOW ? tapCount.current + 1 : 1;
    lastTap.current = now;
    if (tapCount.current >= ADMIN_TAP_COUNT) {
      tapCount.current = 0;
      setAdminOpen(true);
    }
  };

  return (
    <div className={styles.settings}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('home')} aria-label="Back">
          <ChevronLeft size={26} strokeWidth={2} aria-hidden />
        </button>
        {/* Tapping the title rapidly {ADMIN_TAP_COUNT}× reveals the hidden admin panel. */}
        <h1 className={styles.title} onClick={onTitleTap}>
          Settings
        </h1>
      </header>

      <div className={styles.body}>
        {platform && (
          <section className={styles.group}>
            <div className={styles.install}>
              <InstallInstructions platform={platform} install={install} />
            </div>
          </section>
        )}

        <section className={styles.group}>
          <SliderRow
            label="Sound Effects"
            value={soundVolume}
            onChange={setSoundVolume}
            onCommit={previewSound}
          />
          <SliderRow label="Music" value={musicVolume} onChange={setMusicVolume} />
          {hapticsSupported() && <ToggleRow label="Haptics" checked={haptics} onToggle={toggleHaptics} />}
        </section>

        <section className={styles.group}>
          <ToggleRow label="Color Patterns" checked={patterns} onToggle={togglePatterns} />
          <p className={styles.hint}>Adds a distinct texture to each color, for easier telling apart.</p>
        </section>

        <section className={styles.group}>
          <button className={styles.danger} onClick={onStartOver} disabled={fresh}>
            Start Over
          </button>
          <p className={styles.hint}>
            {fresh
              ? 'You are on level 1 — nothing to reset yet.'
              : `Erase your progress (reached level ${furthest}) and begin again from level 1.`}
          </p>
        </section>

        {adminOpen && <AdminPanel />}

        <footer className={styles.footer}>
          <span>Level build {GENERATOR_VERSION}</span>
          <span>{BAKED_LEVEL_COUNT} levels</span>
        </footer>
      </div>
    </div>
  );
}
