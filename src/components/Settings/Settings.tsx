import { ChevronLeft } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { navigate } from '../../useHashRoute';
import styles from './Settings.module.css';

/** Settings screen: app-level actions. Currently just "Start Over" (wipe progress). */
export function Settings() {
  const level = useGameStore((s) => s.level);
  const startOver = useGameStore((s) => s.startOver);
  const fresh = level <= 1;

  const onStartOver = () => {
    if (window.confirm('Start over from level 1? Your progress will be erased.')) {
      startOver();
      navigate('play');
    }
  };

  return (
    <div className={styles.settings}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('home')} aria-label="Back">
          <ChevronLeft size={26} strokeWidth={2} aria-hidden />
        </button>
        <h1 className={styles.title}>Settings</h1>
      </header>

      <section className={styles.group}>
        <button className={styles.danger} onClick={onStartOver} disabled={fresh}>
          Start Over
        </button>
        <p className={styles.hint}>
          {fresh
            ? 'You are on level 1 — nothing to reset yet.'
            : `Erase your progress (currently level ${level}) and begin again from level 1.`}
        </p>
      </section>
    </div>
  );
}
