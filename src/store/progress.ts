/**
 * Campaign progress persisted to localStorage: which level the player has reached, their best
 * (fewest) move count per completed level, and the best star rating earned per level. One
 * versioned blob under a single key. Every access is wrapped so a disabled/full/private-mode
 * storage degrades to in-memory defaults rather than throwing.
 */
import type { DailyRecord } from '../game/daily';
import type { Stars } from '../game/stars';

const KEY = 'magic-color:v1';
const VERSION = 1;

export interface Progress {
  version: number;
  /** The level the player is currently on (1-based). */
  current: number;
  /** Best move count keyed by level number, for completed levels. */
  best: Record<number, number>;
  /** Best star rating (1-3) keyed by level number, for completed levels. */
  stars: Record<number, Stars>;
  /** Longest win streak in the post-campaign endless "Random Hard" mode. */
  randomHardBestStreak: number;
  /** Lifetime count of hints taken (every hint tap that surfaced a move), across all play. */
  hintsUsed: number;
  /** Best daily-challenge result keyed by UTC date string (`YYYY-MM-DD`); presence means "solved". */
  daily: Record<string, DailyRecord>;
}

function defaults(): Progress {
  return {
    version: VERSION,
    current: 1,
    best: {},
    stars: {},
    randomHardBestStreak: 0,
    hintsUsed: 0,
    daily: {},
  };
}

function asRecord<T>(value: unknown): Record<number, T> {
  return value && typeof value === 'object' ? (value as Record<number, T>) : {};
}

/** Parse the daily-results map, keeping only well-formed `{ stars, moves }` entries. */
function asDaily(value: unknown): Record<string, DailyRecord> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, DailyRecord> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const { stars, moves } = raw as { stars?: unknown; moves?: unknown };
    if (typeof stars !== 'number' || typeof moves !== 'number') continue;
    const s = Math.min(3, Math.max(1, Math.floor(stars))) as Stars;
    out[key] = { stars: s, moves: Math.max(0, Math.floor(moves)) };
  }
  return out;
}

/** Load progress, returning fresh defaults on any error or shape mismatch. */
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    if (parsed.version !== VERSION || typeof parsed.current !== 'number') return defaults();
    return {
      version: VERSION,
      current: Math.max(1, Math.floor(parsed.current)),
      best: asRecord<number>(parsed.best),
      stars: asRecord<Stars>(parsed.stars),
      // Additive field — older saves (which lack it) just default to 0, no version bump needed.
      randomHardBestStreak:
        typeof parsed.randomHardBestStreak === 'number' ? Math.max(0, Math.floor(parsed.randomHardBestStreak)) : 0,
      // Additive field — older saves default to 0, no version bump needed.
      hintsUsed: typeof parsed.hintsUsed === 'number' ? Math.max(0, Math.floor(parsed.hintsUsed)) : 0,
      // Additive field — older saves (which lack it) default to an empty map, no version bump needed.
      daily: asDaily(parsed.daily),
    };
  } catch {
    return defaults();
  }
}

/** Persist progress. Silently no-ops if storage is unavailable. */
export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Storage unavailable (private mode / quota) — progress just won't survive a reload.
  }
}

/**
 * Record a completed level's result: keep the fewest moves and the most stars seen. Returns the
 * updated progress (immutably). Does not advance `current` — that's the caller's call.
 */
export function recordResult(
  progress: Progress,
  level: number,
  moves: number,
  stars: Stars,
): Progress {
  const prevMoves = progress.best[level];
  const prevStars = progress.stars[level];
  const best = prevMoves !== undefined && prevMoves <= moves ? progress.best : { ...progress.best, [level]: moves };
  const starMap =
    prevStars !== undefined && prevStars >= stars ? progress.stars : { ...progress.stars, [level]: stars };
  return { ...progress, best, stars: starMap };
}

/** Keep the longest random-hard win streak seen. Returns the updated progress (immutably). */
export function recordRandomHardStreak(progress: Progress, streak: number): Progress {
  if (streak <= progress.randomHardBestStreak) return progress;
  return { ...progress, randomHardBestStreak: streak };
}

/** Tally one more hint taken. Returns the updated progress (immutably). */
export function recordHint(progress: Progress): Progress {
  return { ...progress, hintsUsed: progress.hintsUsed + 1 };
}

/**
 * Record a daily-challenge result for `key`, keeping the best (most stars, fewest moves) seen that
 * day — so replaying to improve a result sticks, but a worse replay never downgrades it. Returns the
 * updated progress (immutably).
 */
export function recordDaily(progress: Progress, key: string, stars: Stars, moves: number): Progress {
  const prev = progress.daily[key];
  // Better = more stars, or the same stars in fewer moves.
  const improved = !prev || stars > prev.stars || (stars === prev.stars && moves < prev.moves);
  if (!improved) return progress;
  return { ...progress, daily: { ...progress.daily, [key]: { stars, moves } } };
}

/** Clear all saved progress (the Home screen's "Start Over"). */
export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
