import { useGameStore } from '../../store/gameStore';
import styles from './Stats.module.css';

/** Move counter and par, shown under the difficulty selector. */
export function Stats() {
  const moves = useGameStore((s) => s.moves.length);
  const par = useGameStore((s) => s.par);

  return (
    <div className={styles.stats}>
      <span>
        Moves <b>{moves}</b>
      </span>
      <span className={styles.sep}>·</span>
      <span>
        Par <b>{par}</b>
      </span>
    </div>
  );
}
