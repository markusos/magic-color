import { motion } from 'framer-motion';
import { cssColor } from '../../theme/colors';
import styles from './LiquidSegment.module.css';

interface Props {
  color: string;
  /** True for the bottom-most segment, to round the base of the liquid column. */
  isBottom: boolean;
}

/** A single color layer inside a bottle. Animates in/out as liquid is poured. */
export function LiquidSegment({ color, isBottom }: Props) {
  return (
    <motion.div
      layout
      initial={{ scaleY: 0, opacity: 0 }}
      animate={{ scaleY: 1, opacity: 1 }}
      exit={{ scaleY: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className={`${styles.segment} ${isBottom ? styles.bottom : ''}`}
      style={{ backgroundColor: cssColor(color) }}
    />
  );
}
