/**
 * The dead-end panel's contents — the terminal alert for both ways an attempt can end without a win:
 * a hard wall (`deadlocked`, no legal move at all) and a `stuck` loop (moves remain, but every
 * reachable board has already been seen this attempt).
 *
 * Restart is the only way out on purpose. A step-by-step Undo is deliberately NOT offered: walking
 * back one move at a time would leak exactly how far back the player went wrong.
 */
import { RotateCcw } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import styles from './Overlay.module.css';

export function DeadEndPanel({ stuck, titleId }: { stuck: boolean; titleId: string }) {
  const restart = useGameStore((s) => s.restart);

  return (
    <>
      <h2 className={styles.fail} id={titleId}>
        {stuck ? 'No way forward' : 'No moves left'}
      </h2>
      <p className={styles.sub}>
        {stuck
          ? 'Every move just loops back — restart to try again.'
          : 'This board is stuck — restart to try again.'}
      </p>
      <button className={styles.primary} onClick={restart}>
        <RotateCcw size={18} strokeWidth={2} aria-hidden />
        Restart Level
      </button>
    </>
  );
}
