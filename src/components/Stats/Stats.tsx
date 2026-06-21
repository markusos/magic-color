import { useGameStore } from '../../store/gameStore';
import { starsFor } from '../../game/stars';
import { Stars } from '../Stars/Stars';
import styles from './Stats.module.css';

/**
 * Live star rating for the current attempt, shown under the level header. Starts at three stars
 * and dims as the score crosses each threshold — a running preview of the rating you're heading
 * for. The score counts undos too (`moves + undos`), so the stars visibly drop when you undo.
 */
export function Stats() {
  const moves = useGameStore((s) => s.moves.length);
  const undos = useGameStore((s) => s.undos);
  const optimal = useGameStore((s) => s.optimal);
  const twoStarMax = useGameStore((s) => s.twoStarMax);

  return (
    <div className={styles.stats}>
      <Stars value={starsFor(moves + undos, optimal, twoStarMax)} size={20} />
    </div>
  );
}
