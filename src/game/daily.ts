/**
 * Daily challenge — the date-seeded showcase board (Track B2). Everything here is PURE and fully
 * client-side: the seed is derived from the UTC date alone, so every device computes the SAME daily
 * board for a given day with no server ("shared" without a backend); the result is persisted locally
 * and the share is a copyable text line — no leaderboard, no cross-device sync. The board GENERATION
 * itself lives in `levelLoader.ts` (`generateDailyLevel`, the live generator); this module owns the
 * date ↔ seed ↔ streak ↔ share arithmetic so it's unit-testable in isolation.
 */
import type { Stars } from './stars';

/**
 * The UTC date key (`YYYY-MM-DD`) for a Date — the daily's identity. Deriving it in UTC (not local
 * time) is what makes the "same board everywhere" property hold: two players in different time zones
 * roll over to the next daily at the same instant.
 */
export function dailyKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's daily key (UTC). */
export function todayKey(): string {
  return dailyKey(new Date());
}

/** A player's stored result for one daily. Presence in the results map means "solved that day". */
export interface DailyRecord {
  /** Best star rating earned that day. */
  stars: Stars;
  /** Fewest moves used that day (the score that earned `stars`). */
  moves: number;
}

/**
 * A 32-bit seed from a daily key — xmur3, mirroring `progression.seedForLevel` but date-keyed and
 * self-contained (no import from the bake-hashed `progression.ts`, so the daily can't accidentally
 * force a re-bake).
 */
export function dailySeed(key: string): number {
  const str = `magic-color:daily:${key}`;
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The previous day's key (UTC), for walking a streak backward. */
function previousKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - 1);
  return dailyKey(date);
}

/**
 * Consecutive solved days ending at `today` (inclusive). Counts back day-by-day while each prior
 * date has a recorded result; the first missed day ends the streak. If today isn't solved yet the
 * count starts from yesterday — an unfinished today shouldn't read as a broken streak, only a missed
 * one does.
 */
export function dailyStreak(results: Record<string, DailyRecord>, today: string): number {
  let streak = 0;
  let key = results[today] ? today : previousKey(today);
  while (results[key]) {
    streak += 1;
    key = previousKey(key);
  }
  return streak;
}

/** The deployed game URL, appended to a share so the result links back to play. */
export const GAME_URL = 'https://magic-color.ostberg.dev/';

/**
 * The copyable share text — a result line plus the game URL on its own line so it stays clickable
 * when pasted, e.g. `Magic Color · 2026-06-23 · ⭐⭐ · 14 moves` then `https://magic-color.ostberg.dev/`.
 */
export function dailyShareText(key: string, record: DailyRecord): string {
  const stars = '⭐'.repeat(record.stars);
  const moves = `${record.moves} move${record.moves === 1 ? '' : 's'}`;
  return `Magic Color · ${key} · ${stars} · ${moves}\n${GAME_URL}`;
}
