import { useGameStore } from '../../store/gameStore';
import styles from './Toolbar.module.css';

/** Bottom bar: move stats plus the Undo / Restart controls. */
export function Toolbar() {
  const undo = useGameStore((s) => s.undo);
  const restart = useGameStore((s) => s.restart);
  const moves = useGameStore((s) => s.moves);
  const par = useGameStore((s) => s.par);

  return (
    <div className={styles.toolbar}>
      <div className={styles.stats}>
        <span className={styles.stat}>
          Moves <b>{moves.length}</b>
        </span>
        <span className={styles.stat}>
          Par <b>{par}</b>
        </span>
      </div>

      <div className={styles.tools}>
        <button onClick={undo} disabled={moves.length === 0} title="Undo">
          ↩ Undo
        </button>
        <button onClick={restart} title="Restart this level">
          ⟳ Restart
        </button>
      </div>
    </div>
  );
}
