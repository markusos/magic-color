import { useGameStore } from '../../store/gameStore';
import type { Difficulty } from '../../game/types';
import styles from './DifficultySelector.module.css';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
};

/** Tier selector, shown in the header above the board. Picking a tier starts a new game. */
export function DifficultySelector() {
  const difficulty = useGameStore((s) => s.difficulty);
  const newGame = useGameStore((s) => s.newGame);

  return (
    <div className={styles.tiers}>
      {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => (
        <button
          key={d}
          className={d === difficulty ? styles.active : ''}
          onClick={() => newGame(d)}
        >
          {DIFFICULTY_LABELS[d]}
        </button>
      ))}
    </div>
  );
}
