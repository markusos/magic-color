import { Settings as SettingsIcon } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { BAKED_LEVEL_COUNT } from '../../game/levelLoader';
import { navigate } from '../../useHashRoute';
import { InstallBanner } from '../InstallBanner/InstallBanner';
import styles from './Home.module.css';

/**
 * Start screen: resume the campaign (Continue / Play), open the level selector, and a cog
 * linking to Settings. Difficulty is driven by the level number now (no tier selector).
 */
export function Home() {
  const level = useGameStore((s) => s.level);
  const furthest = useGameStore((s) => s.furthest);
  const loadLevel = useGameStore((s) => s.loadLevel);
  const playRandomHard = useGameStore((s) => s.playRandomHard);
  const endlessBestStreak = useGameStore((s) => s.endlessBestStreak);
  const fresh = furthest <= 1;
  // The endless challenge unlocks once every baked campaign level has been cleared.
  const endlessUnlocked = furthest > BAKED_LEVEL_COUNT;

  // Resume the campaign frontier; only reload if we're not already on it (preserves an
  // in-progress board when continuing the furthest level).
  const onPlay = () => {
    if (level !== furthest) loadLevel(furthest);
    navigate('play');
  };

  const onPlayRandomHard = () => {
    playRandomHard();
    navigate('play');
  };

  return (
    <div className={styles.home}>
      <button
        className={styles.settingsLink}
        onClick={() => navigate('settings')}
        aria-label="Settings"
      >
        <SettingsIcon size={24} strokeWidth={2} aria-hidden />
      </button>

      <h1 className={styles.title}>Magic Color</h1>
      <p className={styles.tagline}>Sort the colors. One tube at a time.</p>

      <div className={styles.actions}>
        <button className={styles.primary} onClick={onPlay}>
          {fresh ? 'Play' : `Continue · Level ${furthest}`}
        </button>
        {/* Only meaningful once more than one level is unlocked. */}
        {!fresh && (
          <button className={styles.secondary} onClick={() => navigate('levels')}>
            Levels
          </button>
        )}
        {/* Endless challenge — unlocked after every baked level is cleared. */}
        {endlessUnlocked && (
          <button className={styles.secondary} onClick={onPlayRandomHard}>
            Play Random Hard{endlessBestStreak > 0 ? ` · Best streak ${endlessBestStreak}` : ''}
          </button>
        )}
      </div>

      <InstallBanner />
    </div>
  );
}
