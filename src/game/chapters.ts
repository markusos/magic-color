/**
 * Display-only chapter metadata (the short names shown in the level selector). Kept OUT of
 * `progression.ts` on purpose: that file is hashed by the staleness guard (`scripts/levelVersion.ts`)
 * because everything in it feeds the bake's board output. Chapter names are pure presentation and
 * don't change any board, so editing them here never forces a campaign re-bake.
 *
 * Names are parallel to `MECHANIC_SETS` in `progression.ts` — chapter 0 is the base game, chapter 1
 * adds hidden colors. Keep this in sync if a new chapter is defined there.
 */
const CHAPTER_NAMES: readonly string[] = [
  'Classic', // chapter 0 — base game
  'Hidden Colors', // chapter 1 — + hidden colors
];

/** The short display name of a chapter (clamped to the last defined chapter). */
export function chapterName(chapter: number): string {
  const idx = Math.min(Math.max(0, Math.floor(chapter)), CHAPTER_NAMES.length - 1);
  return CHAPTER_NAMES[idx]!;
}
