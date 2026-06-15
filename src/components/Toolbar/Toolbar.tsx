import { useGameStore } from '../../store/gameStore';
import styles from './Toolbar.module.css';

/** Bottom bar: the Undo / Restart controls. */
export function Toolbar() {
  const undo = useGameStore((s) => s.undo);
  const restart = useGameStore((s) => s.restart);
  const moves = useGameStore((s) => s.moves);

  return (
    <div className={styles.toolbar}>
      <button onClick={undo} disabled={moves.length === 0} title="Undo">
        ↩ Undo
      </button>
      <button onClick={restart} title="Restart this level">
        ⟳ Restart
      </button>
    </div>
  );
}
