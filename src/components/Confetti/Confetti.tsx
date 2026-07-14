import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import styles from './Confetti.module.css';

/** Vibrant confetti colors — a subset of the game palette, picked to read on the dark overlay. */
const COLORS = ['#e02438', '#f2b50c', '#1aa346', '#1c9fe0', '#9b6bf0', '#f7799b', '#0bc6c2', '#ef6d1a'];

const COUNT = 22;

interface Piece {
  x: number; // horizontal drift end, in vw from centre
  rotate: number; // total spin, degrees
  delay: number;
  duration: number;
  color: string;
  size: number;
  round: boolean;
}

/**
 * A one-shot confetti burst for the win celebration (U2). Pieces fall from the top of the overlay,
 * drifting sideways and spinning, then fade — a short, sparse shower so the panel text stays
 * readable. Purely decorative and `pointer-events: none`, so it never intercepts the panel buttons.
 *
 * Respects `prefers-reduced-motion`: when set, the burst is suppressed entirely (renders nothing).
 * Mount it only when you want the burst to play — it animates once on mount and does not loop.
 */
export function Confetti() {
  const reduce = useReducedMotion();

  // Randomised once per mount; a fresh win remounts (keyed by the overlay), giving a new pattern.
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        x: (Math.random() * 2 - 1) * 42,
        rotate: (Math.random() * 2 - 1) * 540,
        delay: Math.random() * 0.25,
        duration: 1.3 + Math.random() * 0.9,
        color: COLORS[i % COLORS.length]!,
        size: 7 + Math.random() * 6,
        round: Math.random() < 0.35,
      })),
    [],
  );

  if (reduce) return null;

  return (
    <div className={styles.layer} aria-hidden>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className={styles.piece}
          style={{
            left: `${50 + (Math.random() * 20 - 10)}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.5,
            borderRadius: p.round ? '50%' : '1px',
            background: p.color,
          }}
          initial={{ y: '-10vh', x: 0, opacity: 0, rotate: 0 }}
          animate={{ y: '85vh', x: `${p.x}vw`, opacity: [0, 1, 1, 0], rotate: p.rotate }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: 'easeIn',
            opacity: { duration: p.duration, delay: p.delay, times: [0, 0.1, 0.75, 1] },
          }}
        />
      ))}
    </div>
  );
}
