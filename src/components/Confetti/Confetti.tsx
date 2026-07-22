import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import styles from './Confetti.module.css';

/** Vibrant confetti colors — a subset of the game palette, picked to read on the dark overlay. */
const COLORS = ['#e02438', '#f2b50c', '#1aa346', '#1c9fe0', '#9b6bf0', '#f7799b', '#0bc6c2', '#ef6d1a'];

export type ConfettiVariant = 'grand' | 'subtle' | 'meager';

/** Tuning per celebration tier: a big 3★ blowout, a modest 2★ nod, a sad little 1★ puff. */
const VARIANTS: Record<
  ConfettiVariant,
  {
    count: number;
    spread: number;
    peakMin: number;
    peakRange: number;
    sizeMin: number;
    sizeRange: number;
    delayRange: number;
  }
> = {
  grand: { count: 90, spread: 24, peakMin: 55, peakRange: 40, sizeMin: 8, sizeRange: 8, delayRange: 0.5 },
  subtle: { count: 20, spread: 14, peakMin: 38, peakRange: 24, sizeMin: 6, sizeRange: 4, delayRange: 0.3 },
  meager: { count: 4, spread: 6, peakMin: 14, peakRange: 10, sizeMin: 5, sizeRange: 3, delayRange: 0.15 },
};

interface Piece {
  left: number; // launch origin, % from left edge
  x: number; // horizontal drift at the end of flight, in vw
  peak: number; // apex height above the bottom edge, in vh
  rotate: number; // total spin, degrees
  delay: number;
  duration: number;
  color: string;
  size: number;
  round: boolean;
}

/**
 * A one-shot confetti burst for the win celebration (U2). Pieces launch upward from the bottom
 * edge like a popper, decelerate to an apex, then gravity pulls them back down off-screen while
 * they drift sideways and spin. Purely decorative and `pointer-events: none`, so it never
 * intercepts the panel buttons.
 *
 * `variant` picks the tier: `grand` (default) is the dense 3★ blowout; `subtle` is a small
 * handful of pieces for a 2★ clear; `meager` is a sad three-or-four-piece puff for a 1★ scrape.
 *
 * Respects `prefers-reduced-motion`: when set, the burst is suppressed entirely (renders nothing).
 * Mount it only when you want the burst to play — it animates once on mount and does not loop.
 */
export function Confetti({ variant = 'grand' }: { variant?: ConfettiVariant }) {
  const reduce = useReducedMotion();
  const v = VARIANTS[variant];

  // Randomised once per mount; a fresh win remounts (keyed by the overlay), giving a new pattern.
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: v.count }, (_, i) => ({
        left: 50 + (Math.random() * 2 - 1) * v.spread,
        x: (Math.random() * 2 - 1) * v.spread * 1.6,
        peak: v.peakMin + Math.random() * v.peakRange,
        rotate: (Math.random() * 2 - 1) * 720,
        delay: Math.random() * v.delayRange,
        duration: 1.7 + Math.random() * 0.8,
        color: COLORS[i % COLORS.length]!,
        size: v.sizeMin + Math.random() * v.sizeRange,
        round: Math.random() < 0.35,
      })),
    [v],
  );

  if (reduce) return null;

  return (
    <div className={styles.layer} aria-hidden>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className={styles.piece}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.5,
            borderRadius: p.round ? '50%' : '1px',
            background: p.color,
          }}
          initial={{ y: '4vh', x: 0, opacity: 1, rotate: 0 }}
          animate={{
            // Ballistic arc: ease-out up to the apex, ease-in back down past the launch point —
            // the keyframe pair approximates constant downward gravity on an initial upward kick.
            y: ['4vh', `${-p.peak}vh`, '10vh'],
            x: `${p.x}vw`,
            opacity: [1, 1, 0],
            rotate: p.rotate,
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            y: { duration: p.duration, delay: p.delay, times: [0, 0.45, 1], ease: ['easeOut', 'easeIn'] },
            x: { duration: p.duration, delay: p.delay, ease: 'linear' },
            rotate: { duration: p.duration, delay: p.delay, ease: 'linear' },
            opacity: { duration: p.duration, delay: p.delay, times: [0, 0.8, 1] },
          }}
        />
      ))}
    </div>
  );
}
