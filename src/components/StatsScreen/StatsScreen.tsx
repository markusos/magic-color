import { useMemo } from 'react';
import { ChevronLeft, Star, Trophy, Flag, Flame } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { navigate } from '../../useHashRoute';
import styles from './StatsScreen.module.css';

/**
 * The aggregate progress screen (Track B1/B3): a read-only roll-up of everything already persisted in
 * the campaign — levels cleared, stars earned, three-star clears, current position, the per-chapter
 * breakdown, and the post-campaign endless best streak. All arithmetic lives in `aggregateProgress`
 * (`progressStats.ts`); this just lays it out. Computed once at mount (navigating here remounts it),
 * so a plain `getState()` read is enough — no reactive subscription needed.
 */
export function StatsScreen() {
  const stats = useMemo(() => useGameStore.getState().campaignStats(), []);
  const { levelsCompleted, campaignLength, totalStars, maxStars, threeStarCount, current } = stats;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('home')} aria-label="Back">
          <ChevronLeft size={26} strokeWidth={2} aria-hidden />
        </button>
        <h1 className={styles.title}>Stats</h1>
      </header>

      <div className={styles.body}>
        <div className={styles.cards}>
          <Card icon={<Flag size={18} aria-hidden />} label="Levels cleared" value={`${levelsCompleted}`} sub={`of ${campaignLength}`} />
          <Card icon={<Star size={18} aria-hidden />} label="Stars earned" value={`${totalStars}`} sub={`of ${maxStars}`} />
          <Card icon={<Trophy size={18} aria-hidden />} label="3-star clears" value={`${threeStarCount}`} sub={`of ${campaignLength}`} />
          <Card icon={<Flag size={18} aria-hidden />} label="Current level" value={`${current}`} sub="campaign" />
        </div>

        {stats.randomHardBestStreak > 0 && (
          <div className={styles.streak}>
            <Flame size={18} aria-hidden />
            <span>Best random streak</span>
            <strong>{stats.randomHardBestStreak}</strong>
          </div>
        )}

        <h2 className={styles.sectionTitle}>Chapters</h2>
        <ul className={styles.chapters}>
          {stats.chapters.map((c) => {
            const pct = c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
            return (
              <li key={c.chapter} className={styles.chapter}>
                <div className={styles.chapterTop}>
                  <span className={styles.chapterName}>{c.name}</span>
                  <span className={styles.chapterCount}>
                    {c.completed}/{c.total}
                  </span>
                </div>
                <div className={styles.bar}>
                  <div className={styles.barFill} style={{ width: `${pct}%` }} />
                </div>
                <div className={styles.chapterStars}>
                  <Star size={12} aria-hidden />
                  {c.stars}/{c.maxStars}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Card({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        {icon}
        <span className={styles.cardLabel}>{label}</span>
      </div>
      <div className={styles.cardValue}>
        {value}
        <span className={styles.cardSub}> {sub}</span>
      </div>
    </div>
  );
}
