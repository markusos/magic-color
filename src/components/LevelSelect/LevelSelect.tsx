import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { navigate } from '../../useHashRoute';
import { Stars } from '../Stars/Stars';
import styles from './LevelSelect.module.css';

/** Levels per page — keeps the rendered DOM bounded no matter how far the player has progressed. */
const PAGE_SIZE = 60;

/**
 * Level selector: every reached level (1..furthest), each showing its best star rating. Tapping
 * a level replays it. Paginated so the grid stays light with hundreds or thousands of levels;
 * opens on the page holding the player's frontier.
 */
export function LevelSelect() {
  const furthest = useGameStore((s) => s.furthest);
  const current = useGameStore((s) => s.level);
  const levelStars = useGameStore((s) => s.levelStars);
  const loadLevel = useGameStore((s) => s.loadLevel);

  const pageCount = Math.max(1, Math.ceil(furthest / PAGE_SIZE));
  // 0-indexed; default to the page that contains the frontier.
  const [page, setPage] = useState(() => Math.floor((furthest - 1) / PAGE_SIZE));
  const gridRef = useRef<HTMLDivElement>(null);

  // Jump the scroll back to the top whenever the page changes.
  useEffect(() => {
    gridRef.current?.scrollTo(0, 0);
  }, [page]);

  const start = page * PAGE_SIZE + 1;
  const end = Math.min(furthest, start + PAGE_SIZE - 1);
  const levels = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const play = (level: number) => {
    loadLevel(level);
    navigate('play');
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('home')} aria-label="Back">
          <ChevronLeft size={26} strokeWidth={2} aria-hidden />
        </button>
        <h1 className={styles.title}>Levels</h1>
      </header>

      <div className={styles.grid} ref={gridRef}>
        {levels.map((level) => {
          const stars = levelStars[level] ?? 0;
          return (
            <button
              key={level}
              className={`${styles.cell} ${level === current ? styles.active : ''}`}
              onClick={() => play(level)}
            >
              <span className={styles.num}>{level}</span>
              <Stars value={stars} size={13} />
            </button>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className={styles.pager}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous levels"
          >
            <ChevronLeft size={20} strokeWidth={2} aria-hidden />
          </button>
          <span className={styles.range}>
            {start}–{end}
          </span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            aria-label="Next levels"
          >
            <ChevronRight size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
