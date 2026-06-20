/**
 * The campaign progress service: the single owner of the player's persisted progress and the
 * only place that reads or writes localStorage. The game store consults it for per-level records
 * and tells it when the player reaches or completes a level; the store never touches storage
 * itself.
 *
 * Pure progress *shaping* (load/parse/merge) lives in `progress.ts`; this adds the small stateful
 * layer on top — holding the current blob in memory and persisting it on every change — so the
 * store can stay focused on board play.
 */
import {
  clearProgress,
  loadProgress,
  recordRandomHardStreak,
  recordResult,
  saveProgress,
  type Progress,
} from './progress';
import type { Stars } from '../game/stars';

/** A player's saved result for a single level. */
export interface LevelRecord {
  /** Fewest moves used to solve it, or null if never solved. */
  best: number | null;
  /** Best star rating earned, or null if never solved. */
  bestStars: Stars | null;
}

export interface Campaign {
  /** The unlock frontier — the highest level reached (the level selector lists 1..furthest). */
  readonly furthest: number;
  /** Best star rating per reached level, for the level selector. */
  readonly levelStars: Record<number, Stars>;
  /** Longest win streak in the endless "Random Hard" mode. */
  readonly randomHardBestStreak: number;
  /** The player's saved record for a level. */
  recordFor: (level: number) => LevelRecord;
  /** Mark a level as reached (raises the frontier, never lowers it) and persist. */
  reach: (level: number) => void;
  /** Record a completed level's result (keeps the best moves/stars) and persist. */
  complete: (level: number, moves: number, stars: Stars) => LevelRecord;
  /** Record a random-hard win streak (keeps the longest seen) and persist; returns the best. */
  recordRandomHard: (streak: number) => number;
  /** Raise the frontier toward `level` (clamped to 1..`max`) for the admin unlock; persist. */
  unlockTo: (level: number, max: number) => void;
  /** Wipe all saved progress and reset to level 1. */
  reset: () => void;
}

/**
 * Create a campaign service backed by localStorage. Loads the persisted progress once; thereafter
 * every mutator updates the in-memory blob and writes it through synchronously.
 */
export function createCampaign(): Campaign {
  let progress: Progress = loadProgress();

  const recordFor = (level: number): LevelRecord => ({
    best: progress.best[level] ?? null,
    bestStars: progress.stars[level] ?? null,
  });

  return {
    get furthest() {
      return progress.current;
    },
    get levelStars() {
      return progress.stars;
    },
    get randomHardBestStreak() {
      return progress.randomHardBestStreak;
    },
    recordFor,
    reach(level) {
      progress = { ...progress, current: Math.max(progress.current, level) };
      saveProgress(progress);
    },
    complete(level, moves, stars) {
      progress = recordResult(progress, level, moves, stars);
      saveProgress(progress);
      return recordFor(level);
    },
    recordRandomHard(streak) {
      progress = recordRandomHardStreak(progress, streak);
      saveProgress(progress);
      return progress.randomHardBestStreak;
    },
    unlockTo(level, max) {
      const target = Math.max(1, Math.min(max, Math.floor(level)));
      progress = { ...progress, current: Math.max(progress.current, target) };
      saveProgress(progress);
    },
    reset() {
      clearProgress();
      progress = loadProgress();
    },
  };
}
