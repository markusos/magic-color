import { ChevronLeft } from 'lucide-react';
import { GameBoard } from '../GameBoard/GameBoard';
import { Loader } from '../Loader/Loader';
import { Stats } from '../Stats/Stats';
import { InfoButton } from '../InfoButton/InfoButton';
import { Toolbar } from '../Toolbar/Toolbar';
import { Overlay } from '../Overlay/Overlay';
import { useGameStore } from '../../store/gameStore';
import type { Difficulty } from '../../game/types';
import { navigate } from '../../useHashRoute';
import appStyles from '../../App.module.css';
import styles from './GameScreen.module.css';

const PHASE_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

/** The playing screen: header with level/phase, the board, the toolbar, and end overlays. */
export function GameScreen() {
  const level = useGameStore((s) => s.level);
  const phase = useGameStore((s) => s.phase);
  const loading = useGameStore((s) => s.loading);
  const mode = useGameStore((s) => s.mode);
  const endlessStreak = useGameStore((s) => s.endlessStreak);
  const dailyKey = useGameStore((s) => s.dailyKey);

  return (
    <>
      <header className={appStyles.header}>
        <button className={styles.home} onClick={() => navigate('home')} aria-label="Home">
          <ChevronLeft size={26} strokeWidth={2} aria-hidden />
        </button>
        <div className={styles.levelInfo}>
          {mode === 'daily' ? (
            <>
              <span className={styles.level}>Daily</span>
              <span className={styles.phase} data-phase={phase}>
                {dailyKey ?? PHASE_LABEL[phase]}
              </span>
            </>
          ) : mode === 'endless' ? (
            <>
              <span className={styles.level}>Random</span>
              <span className={styles.phase} data-phase={phase}>
                {endlessStreak > 0 ? `Streak ${endlessStreak}` : PHASE_LABEL[phase]}
              </span>
            </>
          ) : (
            <>
              <span className={styles.level}>Level {level}</span>
              <span className={styles.phase} data-phase={phase}>
                {PHASE_LABEL[phase]}
              </span>
            </>
          )}
        </div>
        <InfoButton />
        <Stats />
      </header>

      {loading ? <Loader /> : <GameBoard />}

      <footer className={appStyles.footer}>
        <Toolbar />
      </footer>

      <Overlay />
    </>
  );
}
