/**
 * Pure aggregation over the persisted campaign progress — the data behind the Stats screen (B1) and
 * the endless-mode framing (B3). A read-only fold of the existing `Progress` blob into the numbers a
 * player wants to see (levels completed, stars earned, chapter-by-chapter progress, campaign
 * position); it adds NO new persistence and never touches storage. Kept out of the component so the
 * arithmetic is unit-testable against a hand-built progress fixture.
 */
import { CAMPAIGN_LENGTH, CHAPTER_LEN, DEFINED_CHAPTERS } from '../game/progression';
import { chapterName } from '../game/chapters';
import type { Progress } from './progress';

/** Per-chapter rollup for the stats screen. */
export interface ChapterStats {
  /** 0-based chapter index. */
  chapter: number;
  /** Display name (e.g. "Classic", "Deep Freeze"). */
  name: string;
  /** Levels in the chapter (always `CHAPTER_LEN`). */
  total: number;
  /** Levels in the chapter the player has genuinely solved (a star recorded). */
  completed: number;
  /** Stars earned across the chapter's solved levels. */
  stars: number;
  /** Maximum stars obtainable in the chapter (`total * 3`). */
  maxStars: number;
}

/** Whole-campaign rollup for the stats screen. */
export interface CampaignStats {
  /** Levels solved across the whole campaign. */
  levelsCompleted: number;
  /** Total campaign levels (the full baked length). */
  campaignLength: number;
  /** Stars earned across all solved levels. */
  totalStars: number;
  /** Maximum stars obtainable across the campaign. */
  maxStars: number;
  /** How many solved levels earned the full three stars. */
  threeStarCount: number;
  /** The level the player is currently on (1-based, clamped into the campaign). */
  current: number;
  /** Per-chapter breakdown, in chapter order. */
  chapters: ChapterStats[];
  /** Longest win streak in the post-campaign endless "Random Hard" mode (B3). */
  randomHardBestStreak: number;
}

/**
 * Fold a `Progress` blob into display aggregates. "Completed" counts only genuinely solved levels —
 * those with a star recorded — so the admin-unlock sentinel (a `best` with no star; see
 * `campaign.unlockTo`) is correctly excluded. Levels outside the defined campaign range are ignored.
 */
export function aggregateProgress(progress: Progress): CampaignStats {
  const chapters: ChapterStats[] = Array.from({ length: DEFINED_CHAPTERS }, (_, chapter) => ({
    chapter,
    name: chapterName(chapter),
    total: CHAPTER_LEN,
    completed: 0,
    stars: 0,
    maxStars: CHAPTER_LEN * 3,
  }));

  let levelsCompleted = 0;
  let totalStars = 0;
  let threeStarCount = 0;

  for (const [key, value] of Object.entries(progress.stars)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 1 || level > CAMPAIGN_LENGTH) continue;
    const stars = value;
    const chapter = Math.floor((level - 1) / CHAPTER_LEN);
    const bucket = chapters[chapter];
    if (!bucket) continue;
    bucket.completed += 1;
    bucket.stars += stars;
    levelsCompleted += 1;
    totalStars += stars;
    if (stars >= 3) threeStarCount += 1;
  }

  return {
    levelsCompleted,
    campaignLength: CAMPAIGN_LENGTH,
    totalStars,
    maxStars: CAMPAIGN_LENGTH * 3,
    threeStarCount,
    current: Math.min(Math.max(1, Math.floor(progress.current)), CAMPAIGN_LENGTH),
    chapters,
    randomHardBestStreak: progress.randomHardBestStreak,
  };
}
