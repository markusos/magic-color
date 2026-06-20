import { useEffect, useRef } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
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

/** Tube tilt when selected (deg) — must match the spring target in the effect below. */
const TILT_DEG = 6;
const SEG_ASPECT = 0.72; // segment height / bottle width, mirrors useBottleMetrics
const NECK_FACTOR = 0.4; // extra tube height (neck/base) in segments, mirrors useBottleMetrics

/**
 * Horizontal over-scale for the upright liquid block so it keeps covering the tilted glass
 * interior (the glass clips the overflow). The liquid counter-rotates to stay world-level while
 * the glass tilts by TILT_DEG, so the block has to widen by cos θ + aspect·sin θ to reach the
 * tilted corners. The aspect term means tall tubes need much more than short ones — a fixed scale
 * (e.g. 1.35, right for capacity 4) leaves the glass showing on capacity-10 tubes. Small margin
 * for the glass border. Excess width is clipped, so erring large is harmless.
 */
function coverScaleX(capacity: number): number {
  const tilt = (TILT_DEG * Math.PI) / 180;
  const aspect = SEG_ASPECT * (capacity + NECK_FACTOR);
  return Math.cos(tilt) + aspect * Math.sin(tilt) + 0.05;
}

/** A test tube of stacked liquid segments. Lifts and tilts slightly when selected. */
export function Bottle({ bottle, capacity, hidden, selected, isTarget, lift, onTap }: Props) {
  const segments = bottle.slice(0, capacity);
  const capped = isCapped(bottle, capacity, hidden);

  // Stagger a multi-band pour so the liquid rises bottom-to-top instead of every new band popping
  // in at once. Bands present before this render don't re-animate (AnimatePresence keeps them), so
  // we only delay the freshly added ones, stepped by how far above the previous fill line they are.
  const prevFillRef = useRef(segments.length);
  const prevFill = prevFillRef.current;
  useEffect(() => {
    prevFillRef.current = segments.length;
  }, [segments.length]);

  // One spring drives the tube's tilt; the liquid reads the exact negation every frame, so the
  // counter-rotation cancels the tilt perfectly throughout the animation (two independent springs
  // drift apart mid-transition and make the surface wobble). The liquid stays world-level.
  const tubeRotate = useMotionValue(0);
  const liquidRotate = useTransform(tubeRotate, (r) => -r);
  useEffect(() => {
    const controls = animate(tubeRotate, selected ? -TILT_DEG : 0, {
      type: 'spring',
      stiffness: 420,
      damping: 26,
    });
    return () => controls.stop();
  }, [selected, tubeRotate]);

  return (
    <motion.button
      type="button"
      className={`${styles.bottle} ${isTarget ? styles.target : ''}`}
      onClick={onTap}
      aria-label={`bottle with ${bottle.length} of ${capacity} filled`}
      animate={{ y: selected ? -lift : 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      whileTap={{ scale: 0.96 }}
      style={{ height: `calc(var(--segment-height) * ${capacity} + var(--segment-height) * 0.4)` }}
    >
      {/* The tube tilts here (not on the button) so its rotation is a clean motion value the liquid
          can mirror — Framer's gesture/animate system on the button would otherwise override it. */}
      <motion.div className={styles.tube} style={{ rotate: tubeRotate }}>
        <div className={styles.glass}>
        {/* Counter-rotate the liquid against the tube's tilt so its surfaces stay level with the
            world — the tilt then reads as the liquid sloshing rather than the whole column
            rotating rigidly. `liquidRotate` is the exact negation of the tube's rotation (shared
            motion value), so it cancels at every instant with no wobble. The gap-covering scale
            lives on the inner element as plain CSS. */}
        <motion.div className={styles.liquidTilt} style={{ rotate: liquidRotate }}>
          <div
            className={styles.liquidColumn}
            style={{ transform: selected ? `scaleX(${coverScaleX(capacity)}) scaleY(1.05)` : undefined }}
          >
            <AnimatePresence initial={false}>
              {segments.map((color, i) => (
                <LiquidSegment
                  key={i}
                  color={color}
                  isBottom={i === 0}
                  isTop={i === segments.length - 1}
                  hidden={hidden?.[i]}
                  fillDelay={i >= prevFill ? (i - prevFill) * 0.08 : 0}
                />
              ))}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Concealed "?" marks live here, in the tube's frame (not the counter-rotated liquid), so
            they stay centred on the tube's axis and tilt with it. Drawing them inside the liquid
            instead pins them to the liquid's vertical centre-line, which drifts off-axis as the
            tube tilts. Positioned by band index from the bottom. */}
        {segments.some((_, i) => hidden?.[i]) && (
          <div className={styles.marks} aria-hidden>
            {segments.map((_, i) =>
              hidden?.[i] ? (
                <span
                  key={i}
                  className={styles.mark}
                  style={{ bottom: `calc(${i} * var(--segment-height))` }}
                >
                  ?
                </span>
              ) : null,
            )}
          </div>
        )}
        </div>
      </motion.div>

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
