import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { chapterName } from '../../game/chapters';
import { CHAPTER_LEN } from '../../game/progression';
import { useGameStore } from '../../store/gameStore';
import { navigate } from '../../useHashRoute';
import { Stars } from '../Stars/Stars';
import styles from './LevelSelect.module.css';

/** One page = one chapter. Levels never run past the baked campaign, so this is always a full chapter. */
const PAGE_SIZE = CHAPTER_LEN;

/**
 * Level selector: one chapter per page (its 30 levels with the chapter's short name), each level
 * showing its best star rating. Tapping a level replays it. Chevrons page between chapters; opens on
 * the chapter holding the player's frontier. The grid never extends past the last campaign level —
 * the post-campaign random mode lives elsewhere and doesn't unlock or save levels.
 */
export function LevelSelect() {
  const furthest = useGameStore((s) => s.furthest);
  const current = useGameStore((s) => s.level);
  const levelStars = useGameStore((s) => s.levelStars);
  const loadLevel = useGameStore((s) => s.loadLevel);

  const pageCount = Math.max(1, Math.ceil(furthest / PAGE_SIZE));
  // 0-indexed; page === chapter index. Default to the chapter that contains the frontier.
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
        <h1 className={styles.title}>{chapterName(page)}</h1>
        <span className={styles.subtitle}>
          Chapter {page + 1} · Levels {start}–{page * PAGE_SIZE + PAGE_SIZE}
        </span>
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
            aria-label="Previous chapter"
          >
            <ChevronLeft size={20} strokeWidth={2} aria-hidden />
          </button>
          <span className={styles.range}>
            {page + 1} / {pageCount}
          </span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            aria-label="Next chapter"
          >
            <ChevronRight size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
