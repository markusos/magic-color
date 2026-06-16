/**
 * Campaign progress persisted to localStorage: which level the player has reached, their best
 * (fewest) move count per completed level, and the best star rating earned per level. One
 * versioned blob under a single key. Every access is wrapped so a disabled/full/private-mode
 * storage degrades to in-memory defaults rather than throwing.
 */
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
}

function defaults(): Progress {
  return { version: VERSION, current: 1, best: {}, stars: {} };
}

function asRecord<T>(value: unknown): Record<number, T> {
  return value && typeof value === 'object' ? (value as Record<number, T>) : {};
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

/** Clear all saved progress (the Home screen's "Start Over"). */
export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
