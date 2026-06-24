import { Undo2, RotateCcw, Lightbulb } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import styles from './Toolbar.module.css';

/** Bottom bar: the Undo / Hint / Restart controls. */
export function Toolbar() {
  const undo = useGameStore((s) => s.undo);
  const restart = useGameStore((s) => s.restart);
  const requestHint = useGameStore((s) => s.requestHint);
  const moves = useGameStore((s) => s.moves);
  const status = useGameStore((s) => s.status);

  return (
    <div className={styles.toolbar}>
      <button onClick={undo} disabled={moves.length === 0} title="Undo">
        <Undo2 size={18} strokeWidth={2} aria-hidden />
        Undo
      </button>
      <button onClick={requestHint} disabled={status !== 'playing'} title="Show a hint">
        <Lightbulb size={18} strokeWidth={2} aria-hidden />
        Hint
      </button>
      <button onClick={restart} title="Restart this level">
        <RotateCcw size={18} strokeWidth={2} aria-hidden />
        Restart
      </button>
    </div>
  );
}
