import { Settings as SettingsIcon } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { navigate } from '../../useHashRoute';
import styles from './Home.module.css';

/**
 * Start screen: resume the campaign (Continue / Play), open the level selector, and a cog
 * linking to Settings. Difficulty is driven by the level number now (no tier selector).
 */
export function Home() {
  const level = useGameStore((s) => s.level);
  const furthest = useGameStore((s) => s.furthest);
  const loadLevel = useGameStore((s) => s.loadLevel);
  const fresh = furthest <= 1;

  // Resume the campaign frontier; only reload if we're not already on it (preserves an
  // in-progress board when continuing the furthest level).
  const onPlay = () => {
    if (level !== furthest) loadLevel(furthest);
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
      </div>
    </div>
  );
}
