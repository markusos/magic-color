import { Star } from 'lucide-react';
import styles from './Stars.module.css';

interface Props {
  /** How many of the three stars are filled (0-3). */
  value: number;
  /** Star size in px. */
  size?: number;
}

/** Three-star rating display: filled stars up to `value`, the rest dimmed. */
export function Stars({ value, size = 20 }: Props) {
  return (
    <div className={styles.stars} role="img" aria-label={`${value} of 3 stars`}>
      {[1, 2, 3].map((i) => {
        const filled = i <= value;
        return (
          <Star
            key={i}
            size={size}
            strokeWidth={2}
            className={filled ? styles.filled : styles.empty}
            fill={filled ? 'currentColor' : 'none'}
            aria-hidden
          />
        );
      })}
    </div>
  );
}
