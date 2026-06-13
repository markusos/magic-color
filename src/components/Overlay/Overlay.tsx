import { AnimatePresence, motion } from 'framer-motion';
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
  const difficulty = useGameStore((s) => s.difficulty);
  const newGame = useGameStore((s) => s.newGame);
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
                <h2 className={styles.win}>✨ Level Complete!</h2>
                <p className={styles.sub}>
                  Solved in {moves.length} moves <span className={styles.dim}>(par {par})</span>
                </p>
                <button className={styles.primary} onClick={() => newGame(difficulty)}>
                  Next Level
                </button>
              </>
            ) : (
              <>
                <h2 className={styles.fail}>No moves left</h2>
                <p className={styles.sub}>This board is stuck — undo a move or try again.</p>
                <div className={styles.row}>
                  <button onClick={undo}>↩ Undo</button>
                  <button onClick={restart}>⟳ Restart</button>
                  <button className={styles.primary} onClick={() => newGame(difficulty)}>
                    New Board
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
