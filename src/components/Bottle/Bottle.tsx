import { motion } from 'framer-motion';
import { AnimatePresence } from 'framer-motion';
import type { Bottle as BottleData } from '../../game/types';
import { LiquidSegment } from '../LiquidSegment/LiquidSegment';
import styles from './Bottle.module.css';

interface Props {
  bottle: BottleData;
  capacity: number;
  selected: boolean;
  /** Highlight as a valid pour target while another bottle is selected. */
  isTarget?: boolean;
  onTap: () => void;
}

/** A test tube of stacked liquid segments. Lifts and tilts slightly when selected. */
export function Bottle({ bottle, capacity, selected, isTarget, onTap }: Props) {
  const segments = bottle.slice(0, capacity);

  return (
    <motion.button
      type="button"
      className={`${styles.bottle} ${isTarget ? styles.target : ''}`}
      onClick={onTap}
      aria-label={`bottle with ${bottle.length} of ${capacity} filled`}
      animate={{ y: selected ? -22 : 0, rotate: selected ? -6 : 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      whileTap={{ scale: 0.96 }}
      style={{ height: `calc(var(--segment-height) * ${capacity} + 14px)` }}
    >
      <div className={styles.glass}>
        <div className={styles.liquidColumn}>
          <AnimatePresence initial={false}>
            {segments.map((color, i) => (
              <LiquidSegment key={i} color={color} isBottom={i === 0} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.button>
  );
}
