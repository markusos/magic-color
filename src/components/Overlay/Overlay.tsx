import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, Undo2, RotateCcw } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import styles from './Overlay.module.css';

/**
 * Modal overlays for end-of-attempt states: a celebratory win panel, and the
 * "no moves left" deadlock alert (the source game's instant-failure detection).
 */
export function Overlay() {
  const status = useGameStore((s) => s.status);
  const moves = useGameStore((s) => s.moves);
  const par = useGameStore((s) => s.par);
  const best = useGameStore((s) => s.best);
  const nextLevel = useGameStore((s) => s.nextLevel);
  const undo = useGameStore((s) => s.undo);
  const restart = useGameStore((s) => s.restart);

  const visible = status === 'won' || status === 'deadlocked';

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
                <h2 className={styles.win}>
                  <Sparkles size={22} strokeWidth={2} aria-hidden />
                  Level Complete!
                </h2>
                <p className={styles.sub}>
                  Solved in {moves.length} moves <span className={styles.dim}>(par {par})</span>
                </p>
                {best !== null && best === moves.length && (
                  <p className={styles.sub}>
                    <span className={styles.dim}>New best!</span>
                  </p>
                )}
                <button className={styles.primary} onClick={nextLevel}>
                  Next Level
                </button>
              </>
            ) : (
              <>
                <h2 className={styles.fail}>No moves left</h2>
                <p className={styles.sub}>This board is stuck — undo a move or try again.</p>
                <div className={styles.row}>
                  <button onClick={undo}>
                    <Undo2 size={18} strokeWidth={2} aria-hidden />
                    Undo
                  </button>
                  <button className={styles.primary} onClick={restart}>
                    <RotateCcw size={18} strokeWidth={2} aria-hidden />
                    Restart Level
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
