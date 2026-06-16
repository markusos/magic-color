import { motion } from 'framer-motion';
import { AnimatePresence } from 'framer-motion';
import type { Bottle as BottleData } from '../../game/types';
import { isCapped } from '../../game/hidden';
import { LiquidSegment } from '../LiquidSegment/LiquidSegment';
import styles from './Bottle.module.css';

interface Props {
  bottle: BottleData;
  capacity: number;
  /** Per-segment concealment (bottom-first), for the hidden-colors mechanic. */
  hidden?: boolean[];
  selected: boolean;
  /** Highlight as a valid pour target while another bottle is selected. */
  isTarget?: boolean;
  /** How far (px) the bottle lifts when selected; scales with bottle size. */
  lift: number;
  onTap: () => void;
}

/** A test tube of stacked liquid segments. Lifts and tilts slightly when selected. */
export function Bottle({ bottle, capacity, hidden, selected, isTarget, lift, onTap }: Props) {
  const segments = bottle.slice(0, capacity);
  const capped = isCapped(bottle, capacity, hidden);

  return (
    <motion.button
      type="button"
      className={`${styles.bottle} ${isTarget ? styles.target : ''}`}
      onClick={onTap}
      aria-label={`bottle with ${bottle.length} of ${capacity} filled`}
      animate={{ y: selected ? -lift : 0, rotate: selected ? -6 : 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      whileTap={{ scale: 0.96 }}
      style={{ height: `calc(var(--segment-height) * ${capacity} + var(--segment-height) * 0.4)` }}
    >
      <div className={styles.glass}>
        <div className={styles.liquidColumn}>
          <AnimatePresence initial={false}>
            {segments.map((color, i) => (
              <LiquidSegment key={i} color={color} isBottom={i === 0} hidden={hidden?.[i]} />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {capped && (
          <motion.div
            className={styles.cap}
            initial={{ x: '-50%', y: -lift, opacity: 0, scale: 0.85 }}
            animate={{ x: '-50%', y: 0, opacity: 1, scale: 1 }}
            exit={{ x: '-50%', y: -lift, opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 600, damping: 22 }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}
