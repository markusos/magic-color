import { useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { navigate } from '../../useHashRoute';
import { useInstall } from '../../install/useInstall';
import { BAKED_LEVEL_COUNT } from '../../game/levelLoader';
import { GENERATOR_VERSION } from '../../game/levels.meta';
import { InstallInstructions } from '../InstallBanner/InstallInstructions';
import styles from './Settings.module.css';

/** Number of rapid title taps that reveals the hidden admin level-unlock panel. */
const ADMIN_TAP_COUNT = 7;
/** Taps must land within this window (ms) of each other to count toward the streak. */
const ADMIN_TAP_WINDOW = 600;
/** Admin unlock tops out at the full baked campaign — there are no numbered levels past it. */
const MAX_LEVEL = BAKED_LEVEL_COUNT;

/**
 * Settings screen: app-level actions ("Start Over"), plus a hidden admin hatch for testing.
 *
 * The admin panel — which unlocks every level up to a chosen number — is intentionally
 * undiscoverable: it appears only after tapping the "Settings" title {@link ADMIN_TAP_COUNT}
 * times in quick succession (the classic "tap to enable developer mode" gesture). There is no
 * visible affordance, so ordinary players never stumble into it.
 */
export function Settings() {
  const furthest = useGameStore((s) => s.furthest);
  const startOver = useGameStore((s) => s.startOver);
  const unlockUpTo = useGameStore((s) => s.unlockUpTo);
  // Surface the same install affordance as the home banner, but always (no dismissal) when the app
  // isn't already installed and the platform can offer it.
  const { platform, install } = useInstall();
  // "Progress" means the unlock frontier, not the level being actively played (you may be
  // replaying an earlier one). Nothing to reset only when the frontier is still level 1.
  const fresh = furthest <= 1;

  const [adminOpen, setAdminOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [unlockedTo, setUnlockedTo] = useState<number | null>(null);
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

  const parsed = Number(target);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LEVEL;

  const onUnlock = () => {
    if (!valid) return;
    unlockUpTo(parsed);
    setUnlockedTo(parsed);
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

      {platform && (
        <section className={styles.group}>
          <div className={styles.install}>
            <InstallInstructions platform={platform} install={install} />
          </div>
        </section>
      )}

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

      {adminOpen && (
        <section className={styles.admin}>
          <h2 className={styles.adminTitle}>Admin · Unlock levels</h2>
          <div className={styles.adminRow}>
            <input
              className={styles.adminInput}
              type="number"
              min={1}
              max={MAX_LEVEL}
              inputMode="numeric"
              placeholder={`1–${MAX_LEVEL}`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Level to unlock up to"
            />
            <button className={styles.adminBtn} onClick={onUnlock} disabled={!valid}>
              Unlock
            </button>
          </div>
          <p className={styles.hint}>
            {unlockedTo !== null
              ? `Unlocked levels 1–${unlockedTo}. Frontier is now ${furthest}.${
                  unlockedTo >= MAX_LEVEL ? ' Play Random is unlocked.' : ''
                }`
              : `Unlock every level up to and including this number (frontier is currently ${furthest}). Unlock to ${MAX_LEVEL} to open Play Random.`}
          </p>
        </section>
      )}

      <footer className={styles.footer}>
        <span>Level build {GENERATOR_VERSION}</span>
        <span>{BAKED_LEVEL_COUNT} levels</span>
      </footer>
    </div>
  );
}
