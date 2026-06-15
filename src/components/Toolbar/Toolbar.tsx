import { Undo2, RotateCcw } from 'lucide-react';
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
        <Undo2 size={18} strokeWidth={2} aria-hidden />
        Undo
      </button>
      <button onClick={restart} title="Restart this level">
        <RotateCcw size={18} strokeWidth={2} aria-hidden />
        Restart
      </button>
    </div>
  );
}
