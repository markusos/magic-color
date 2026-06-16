/**
 * Campaign progress persisted to localStorage: which level the player has reached, and their
 * best (fewest) move count per completed level. One versioned blob under a single key. Every
 * access is wrapped so a disabled/full/private-mode storage degrades to in-memory defaults
 * rather than throwing.
 */

const KEY = 'magic-color:v1';
const VERSION = 1;

export interface Progress {
  version: number;
  /** The level the player is currently on (1-based). */
  current: number;
  /** Best move count keyed by level number, for completed levels. */
  best: Record<number, number>;
}

function defaults(): Progress {
  return { version: VERSION, current: 1, best: {} };
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
      best: parsed.best && typeof parsed.best === 'object' ? parsed.best : {},
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
 * Record a completed level's move count if it beats the stored best, returning the updated
 * progress (immutably). Does not advance `current` — that's the caller's call.
 */
export function recordBest(progress: Progress, level: number, moves: number): Progress {
  const prev = progress.best[level];
  if (prev !== undefined && prev <= moves) return progress;
  return { ...progress, best: { ...progress.best, [level]: moves } };
}

/** Clear all saved progress (the Home screen's "Start Over"). */
export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
