import { describe, it, expect } from 'vitest';
import { aggregateProgress } from './progressStats';
import { CAMPAIGN_LENGTH, CHAPTER_LEN, DEFINED_CHAPTERS } from '../game/progression';
import { chapterName } from '../game/chapters';
import type { Stars } from '../game/stars';
import type { Progress } from './progress';

const base = (over: Partial<Progress> = {}): Progress => ({
  version: 1,
  current: 1,
  best: {},
  stars: {},
  randomHardBestStreak: 0,
  ...over,
});

describe('aggregateProgress', () => {
  it('zeroes everything for fresh progress', () => {
    const agg = aggregateProgress(base());
    expect(agg.levelsCompleted).toBe(0);
    expect(agg.totalStars).toBe(0);
    expect(agg.threeStarCount).toBe(0);
    expect(agg.current).toBe(1);
    expect(agg.campaignLength).toBe(CAMPAIGN_LENGTH);
    expect(agg.maxStars).toBe(CAMPAIGN_LENGTH * 3);
    expect(agg.chapters).toHaveLength(DEFINED_CHAPTERS);
    expect(agg.chapters.every((c) => c.completed === 0 && c.stars === 0)).toBe(true);
  });

  it('sums stars and counts three-star clears from a hand-built fixture', () => {
    const stars: Record<number, Stars> = { 1: 3, 2: 1, 3: 2 };
    const agg = aggregateProgress(base({ stars, current: 4 }));
    expect(agg.levelsCompleted).toBe(3);
    expect(agg.totalStars).toBe(6);
    expect(agg.threeStarCount).toBe(1);
    expect(agg.current).toBe(4);
  });

  it('buckets levels into the right chapters', () => {
    // One solved level in chapter 0 (level 1) and one in chapter 1 (level CHAPTER_LEN + 1).
    const stars: Record<number, Stars> = { 1: 2, [CHAPTER_LEN + 1]: 3 };
    const agg = aggregateProgress(base({ stars }));
    expect(agg.chapters[0]).toMatchObject({
      chapter: 0,
      name: chapterName(0),
      total: CHAPTER_LEN,
      completed: 1,
      stars: 2,
      maxStars: CHAPTER_LEN * 3,
    });
    expect(agg.chapters[1]).toMatchObject({ chapter: 1, completed: 1, stars: 3 });
    expect(agg.chapters[2]).toMatchObject({ completed: 0, stars: 0 });
  });

  it('excludes the admin-unlock sentinel (a best with no star)', () => {
    // unlockTo forges a `best` for the last level but records no star — it must not count as solved.
    const agg = aggregateProgress(
      base({ best: { [CAMPAIGN_LENGTH]: Number.MAX_SAFE_INTEGER }, current: CAMPAIGN_LENGTH }),
    );
    expect(agg.levelsCompleted).toBe(0);
    expect(agg.totalStars).toBe(0);
  });

  it('ignores stars recorded outside the campaign range', () => {
    const stars: Record<number, Stars> = { 0: 3, [CAMPAIGN_LENGTH + 1]: 3, 1: 2 };
    const agg = aggregateProgress(base({ stars }));
    expect(agg.levelsCompleted).toBe(1);
    expect(agg.totalStars).toBe(2);
  });

  it('clamps the current position into the campaign and carries the endless streak', () => {
    expect(aggregateProgress(base({ current: 0 })).current).toBe(1);
    expect(aggregateProgress(base({ current: CAMPAIGN_LENGTH + 50 })).current).toBe(CAMPAIGN_LENGTH);
    expect(aggregateProgress(base({ randomHardBestStreak: 7 })).randomHardBestStreak).toBe(7);
  });
});
