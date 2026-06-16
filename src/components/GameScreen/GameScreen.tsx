import { ChevronLeft } from 'lucide-react';
import { GameBoard } from '../GameBoard/GameBoard';
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

  return (
    <>
      <header className={appStyles.header}>
        <button className={styles.home} onClick={() => navigate('home')} aria-label="Home">
          <ChevronLeft size={26} strokeWidth={2} aria-hidden />
        </button>
        <div className={styles.levelInfo}>
          <span className={styles.level}>Level {level}</span>
          <span className={styles.phase} data-phase={phase}>
            {PHASE_LABEL[phase]}
          </span>
        </div>
        <InfoButton />
        <Stats />
      </header>

      <GameBoard />

      <footer className={appStyles.footer}>
        <Toolbar />
      </footer>

      <Overlay />
    </>
  );
}
