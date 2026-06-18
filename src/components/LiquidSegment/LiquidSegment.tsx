import { motion } from 'framer-motion';
import { cssColor } from '../../theme/colors';
import styles from './LiquidSegment.module.css';

interface Props {
  color: string;
  /** True for the bottom-most segment, to round the base of the liquid column. */
  isBottom: boolean;
  /** True for the top-most filled segment, whose top edge is the open liquid surface. */
  isTop: boolean;
  /** Concealed (hidden-colors mechanic): paint a black band (the "?" is drawn by the Bottle). */
  hidden?: boolean;
  /** Seconds to delay this band's fill-in, so a multi-band pour rises bottom-to-top. */
  fillDelay?: number;
}

/**
 * A single color layer inside a bottle. Animates in/out as liquid is poured.
 *
 * The top and bottom edges are reshaped into rippling waves via CSS masks (see the module):
 * a non-bottom layer carries a wavy bottom that overlaps down into the layer below, so adjacent
 * colors interlock along the wave with no gap; the top-most layer also gets a wavy open surface.
 */
export function LiquidSegment({ color, isBottom, isTop, hidden, fillDelay = 0 }: Props) {
  // The interface with the layer below is wavy on every layer except the base (which keeps its
  // rounded bottom). The open surface is wavy only on the top-most layer.
  const waveBottom = !isBottom;
  const waveTop = isTop;
  const spring = { type: 'spring', stiffness: 500, damping: 32 } as const;
  return (
    <motion.div
      initial={{ scaleY: 0, opacity: 0 }}
      // Delay only the fill-in (enter) so bands rise bottom-to-top; emptying (exit) stays prompt.
      animate={{ scaleY: 1, opacity: 1, transition: { ...spring, delay: fillDelay } }}
      exit={{ scaleY: 0, opacity: 0, transition: spring }}
      className={[
        styles.segment,
        isBottom ? styles.bottom : '',
        hidden ? styles.hidden : '',
        waveBottom ? styles.waveBottom : '',
        waveTop ? styles.waveTop : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={hidden ? undefined : { backgroundColor: cssColor(color) }}
    />
  );
}
