import { useEffect } from 'react';
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
  const hintLoading = useGameStore((s) => s.hintLoading);
  const hintUnavailable = useGameStore((s) => s.hintUnavailable);
  const dismissHintUnavailable = useGameStore((s) => s.dismissHintUnavailable);

  // Auto-fade the "No hint available" popover after 2s (re-armed on each new occurrence).
  useEffect(() => {
    if (!hintUnavailable) return;
    const t = setTimeout(dismissHintUnavailable, 2000);
    return () => clearTimeout(t);
  }, [hintUnavailable, dismissHintUnavailable]);

  return (
    <div className={styles.toolbar}>
      <button onClick={undo} disabled={moves.length === 0} title="Undo">
        <Undo2 size={18} strokeWidth={2} aria-hidden />
        Undo
      </button>
      <div className={styles.hintCell}>
        {hintUnavailable && (
          <div className={styles.popover} role="status" aria-live="polite">
            No hint available
          </div>
        )}
        <button onClick={requestHint} disabled={status !== 'playing' || hintLoading} title="Show a hint">
          {hintLoading ? (
            <span className={styles.spinner} aria-hidden />
          ) : (
            <Lightbulb size={18} strokeWidth={2} aria-hidden />
          )}
          Hint
        </button>
      </div>
      <button onClick={restart} title="Restart this level">
        <RotateCcw size={18} strokeWidth={2} aria-hidden />
        Restart
      </button>
    </div>
  );
}
