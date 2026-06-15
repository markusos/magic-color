import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import styles from './InfoButton.module.css';

/** iOS-style ⓘ button in the top-right; taps open a popover with how-to-play text. */
export function InfoButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.info}
        onClick={() => setOpen((o) => !o)}
        aria-label="How to play"
      >
        i
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className={styles.backdrop} onClick={() => setOpen(false)} />
            <motion.div
              className={styles.popover}
              initial={{ opacity: 0, scale: 0.92, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -6 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            >
              <h2 className={styles.title}>How to play</h2>
              <p className={styles.body}>
                Tap a bottle to pick it up, then tap another to pour the top color onto a
                matching color or an empty tube. Sort until every bottle is a single shade.
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
