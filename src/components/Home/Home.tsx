import { Settings as SettingsIcon } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { navigate } from '../../useHashRoute';
import styles from './Home.module.css';

/**
 * Start screen: resume the campaign (Continue / Play) and a cog linking to Settings.
 * The tier selector is gone — difficulty is driven by the level number now.
 */
export function Home() {
  const level = useGameStore((s) => s.level);
  const fresh = level <= 1;

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
        <button className={styles.primary} onClick={() => navigate('play')}>
          {fresh ? 'Play' : `Continue · Level ${level}`}
        </button>
      </div>
    </div>
  );
}
