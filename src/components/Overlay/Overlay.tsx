import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { starsFor } from '../../game/stars';
import { Stars } from '../Stars/Stars';
import styles from './Overlay.module.css';

/**
 * Modal overlays for end-of-attempt states: a celebratory win panel, and a terminal game-over
 * alert for both dead ends — a hard wall (`deadlocked`, no legal move) and a `stuck` loop (moves
 * remain but every reachable board has already been seen). Both end the attempt with Restart;
 * a loop is deliberately NOT offered a step-by-step Undo, which would leak how far back the player
 * went wrong.
 */
export function Overlay() {
  const status = useGameStore((s) => s.status);
  const moves = useGameStore((s) => s.moves);
  const undos = useGameStore((s) => s.undos);
  const optimal = useGameStore((s) => s.optimal);
  const twoStarMax = useGameStore((s) => s.twoStarMax);
  const nextLevel = useGameStore((s) => s.nextLevel);
  const restart = useGameStore((s) => s.restart);
  const mode = useGameStore((s) => s.mode);
  const endlessStreak = useGameStore((s) => s.endlessStreak);

  const endless = mode === 'endless';
  const visible = status === 'won' || status === 'deadlocked' || status === 'stuck';
  // The score (and thus the rating) counts undos used, mirroring the live Stats preview.
  const stars = starsFor(moves.length + undos, optimal, twoStarMax);
  const praise = endless
    ? `Streak ${endlessStreak}!`
    : stars === 3
      ? 'Perfect!'
      : stars === 2
        ? 'Nicely done!'
        : 'Level Complete!';

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
            initial={{ scale: 0.8, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            {status === 'won' ? (
              <>
                <motion.div
                  className={styles.starsRow}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 18, delay: 0.1 }}
                >
                  <Stars value={stars} size={48} />
                </motion.div>
                <h2 className={styles.win}>{praise}</h2>
                <button className={styles.primary} onClick={nextLevel}>
                  {endless ? 'Next Board' : 'Next Level'}
                </button>
              </>
            ) : (
              <>
                <h2 className={styles.fail}>
                  {status === 'stuck' ? 'No way forward' : 'No moves left'}
                </h2>
                <p className={styles.sub}>
                  {status === 'stuck'
                    ? 'Every move just loops back — restart to try again.'
                    : 'This board is stuck — restart to try again.'}
                </p>
                <button className={styles.primary} onClick={restart}>
                  <RotateCcw size={18} strokeWidth={2} aria-hidden />
                  Restart Level
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
