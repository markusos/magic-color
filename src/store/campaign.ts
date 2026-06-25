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
  recordHint,
  recordRandomHardStreak,
  recordResult,
  saveProgress,
  type Progress,
} from './progress';
import { aggregateProgress, type CampaignStats } from './progressStats';
import { BAKED_LEVEL_COUNT } from '../game/levelLoader';
import type { Stars } from '../game/stars';

/** A player's saved result for a single level. */
export interface LevelRecord {
  /** Fewest moves used to solve it, or null if never solved. */
  best: number | null;
  /** Best star rating earned, or null if never solved. */
  bestStars: Stars | null;
}

export interface Campaign {
  /**
   * The unlock frontier — the highest level reached, clamped to the baked campaign (the level
   * selector lists 1..furthest). The campaign no longer extends past the baked levels; once they're
   * all cleared, play continues in the random mode (see `campaignComplete`).
   */
  readonly furthest: number;
  /** Whether the player has completed the last baked campaign level (unlocks the random mode). */
  readonly campaignComplete: boolean;
  /** Best star rating per reached level, for the level selector. */
  readonly levelStars: Record<number, Stars>;
  /** Longest win streak in the endless "Random Hard" mode. */
  readonly randomHardBestStreak: number;
  /** The player's saved record for a level. */
  recordFor: (level: number) => LevelRecord;
  /** Read-only aggregate of all saved progress, for the stats screen. */
  stats: () => CampaignStats;
  /** Mark a level as reached (raises the frontier, never lowers it) and persist. */
  reach: (level: number) => void;
  /** Record a completed level's result (keeps the best moves/stars) and persist. */
  complete: (level: number, moves: number, stars: Stars) => LevelRecord;
  /** Record a random-hard win streak (keeps the longest seen) and persist; returns the best. */
  recordRandomHard: (streak: number) => number;
  /** Tally one hint taken and persist. */
  recordHint: () => void;
  /**
   * Raise the frontier toward `level` (clamped to 1..`max`) for the admin unlock; persist.
   * Unlocking to `max` also flips `campaignComplete`, opening "Play Random".
   */
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
      // Clamp legacy saves that advanced past the baked range (the campaign used to keep going).
      return Math.min(progress.current, BAKED_LEVEL_COUNT);
    },
    get campaignComplete() {
      // Beating the last baked level records a best for it — the signal that the campaign is done.
      // The admin hatch forges the same signal (see `unlockTo`), so there is one source of truth:
      // when a new chapter raises BAKED_LEVEL_COUNT, both organic and admin saves re-arm alike.
      return progress.best[BAKED_LEVEL_COUNT] !== undefined;
    },
    get levelStars() {
      return progress.stars;
    },
    get randomHardBestStreak() {
      return progress.randomHardBestStreak;
    },
    recordFor,
    stats: () => aggregateProgress(progress),
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
    recordHint() {
      progress = recordHint(progress);
      saveProgress(progress);
    },
    unlockTo(level, max) {
      const target = Math.max(1, Math.min(max, Math.floor(level)));
      // Unlocking all the way to the last baked level also opens "Play Random" — there are no
      // numbered levels past it, so the only thing left to reach is the random mode. Forge the same
      // signal an organic finish leaves (a `best` for the last level) rather than a separate flag,
      // so a later chapter (raising `max`) re-arms the campaign exactly like it does for everyone
      // else. A worst-case score means a genuine win later overrides it; no star is recorded, so the
      // selector still shows the level as unplayed.
      const best =
        target >= max && progress.best[max] === undefined
          ? { ...progress.best, [max]: Number.MAX_SAFE_INTEGER }
          : progress.best;
      progress = { ...progress, current: Math.max(progress.current, target), best };
      saveProgress(progress);
    },
    reset() {
      clearProgress();
      progress = loadProgress();
    },
  };
}
