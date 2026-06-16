import { useGameStore } from '../../store/gameStore';
import styles from './Stats.module.css';

/** Move counter, par, and the player's best for this level, shown under the level header. */
export function Stats() {
  const moves = useGameStore((s) => s.moves.length);
  const par = useGameStore((s) => s.par);
  const best = useGameStore((s) => s.best);

  return (
    <div className={styles.stats}>
      <span>
        Moves <b>{moves}</b>
      </span>
      <span className={styles.sep}>·</span>
      <span>
        Par <b>{par}</b>
      </span>
      {best !== null && (
        <>
          <span className={styles.sep}>·</span>
          <span>
            Best <b>{best}</b>
          </span>
        </>
      )}
    </div>
  );
}
