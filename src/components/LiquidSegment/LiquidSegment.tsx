import { motion } from 'framer-motion';
import { cssColor } from '../../theme/colors';
import styles from './LiquidSegment.module.css';

interface Props {
  color: string;
  /** True for the bottom-most segment, to round the base of the liquid column. */
  isBottom: boolean;
  /** Concealed (hidden-colors mechanic): show a black band with a "?" instead of the color. */
  hidden?: boolean;
}

/** A single color layer inside a bottle. Animates in/out as liquid is poured. */
export function LiquidSegment({ color, isBottom, hidden }: Props) {
  return (
    <motion.div
      layout
      initial={{ scaleY: 0, opacity: 0 }}
      animate={{ scaleY: 1, opacity: 1 }}
      exit={{ scaleY: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className={`${styles.segment} ${isBottom ? styles.bottom : ''} ${hidden ? styles.hidden : ''}`}
      style={hidden ? undefined : { backgroundColor: cssColor(color) }}
    >
      {hidden && <span className={styles.mark}>?</span>}
    </motion.div>
  );
}
