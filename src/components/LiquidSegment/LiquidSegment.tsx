import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cssColor, patternFor } from '../../theme/colors';
import styles from './LiquidSegment.module.css';

interface Props {
  color: string;
  /** True for the bottom-most segment, to round the base of the liquid column. */
  isBottom: boolean;
  /** True for the top-most filled segment, whose top edge is the open liquid surface. */
  isTop: boolean;
  /** Concealed (hidden-colors mechanic): paint a black band (the "?" is drawn by the Bottle). */
  hidden?: boolean;
  /** Colorblind aid: overlay this color's distinct texture (see `patternFor`). */
  patterns?: boolean;
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
export function LiquidSegment({ color, isBottom, isTop, hidden, patterns, fillDelay = 0 }: Props) {
  // The interface with the layer below is wavy on every layer except the base (which keeps its
  // rounded bottom). The open surface is wavy only on the top-most layer.
  const waveBottom = !isBottom;
  const waveTop = isTop;
  const spring = { type: 'spring', stiffness: 500, damping: 32 } as const;
  // Colorblind aid: a per-color texture overlay (only when enabled and the band isn't concealed).
  const pattern = patterns && !hidden ? patternFor(color) : '';

  // Reveal (U5): when a cell goes from concealed to revealed (a pour exposed it), briefly lay the
  // frosted cover back over the now-visible color and fade it out, so the color melts into view
  // rather than snapping. Reduced-motion users get the instant swap.
  const reduceMotion = useReducedMotion();
  const prevHidden = useRef(hidden);
  const [revealing, setRevealing] = useState(false);
  useEffect(() => {
    if (prevHidden.current && !hidden && !reduceMotion) setRevealing(true);
    prevHidden.current = hidden;
  }, [hidden, reduceMotion]);

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
    >
      {pattern && <div className="cb-pattern" data-cb={pattern} aria-hidden />}
      {revealing && (
        <motion.div
          className={styles.revealCover}
          aria-hidden
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          onAnimationComplete={() => setRevealing(false)}
        />
      )}
    </motion.div>
  );
}
