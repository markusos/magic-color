import { useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';
import { starsFor } from '../../game/stars';
import { useModalDialog } from '../useModalDialog';
import { WinPanel } from './WinPanel';
import { DeadEndPanel } from './DeadEndPanel';
import styles from './Overlay.module.css';

/**
 * The end-of-attempt modal: the shell both end states share — the backdrop, the dialog itself, and
 * when it is up — plus the attempt's final score, which is the one thing both panels need. The two
 * outcomes then render their own contents ({@link WinPanel} / {@link DeadEndPanel}); they have
 * almost nothing in common beyond sitting in this frame.
 */
export function Overlay() {
  const status = useGameStore((s) => s.status);
  const moves = useGameStore((s) => s.moves);
  const undos = useGameStore((s) => s.undos);
  const optimal = useGameStore((s) => s.optimal);
  const twoStarMax = useGameStore((s) => s.twoStarMax);
  const hintUsed = useGameStore((s) => s.hintUsed);
  const titleId = useId();
  // No `onDismiss`: the attempt is over and the panel exists to make the player choose what happens
  // next (Next Level / Restart / Share), so there is nothing sensible for Escape to do.
  const panelRef = useModalDialog({ open: status !== 'playing' });

  const visible = status === 'won' || status === 'deadlocked' || status === 'stuck';
  // The score (and thus the rating) counts undos used; a hinted solve is capped to 1 star — both
  // mirror the live Stats preview and the recorded result.
  const score = moves.length + undos;
  const stars = hintUsed ? 1 : starsFor(score, optimal, twoStarMax);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={styles.panel}
            // A real dialog: focus moves in, Tab stays in, and the heading names it. See useModalDialog.
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            ref={panelRef}
            initial={{ scale: 0.8, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            {status === 'won' ? (
              <WinPanel stars={stars} score={score} titleId={titleId} />
            ) : (
              <DeadEndPanel stuck={status === 'stuck'} titleId={titleId} />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
