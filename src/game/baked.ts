/**
 * The shape of a pre-baked level: the static data committed by `scripts/build-levels.ts` and loaded
 * by `getLevel` (progression.ts) instead of generating on device. Deliberately minimal — the runtime
 * never needs the generator's `solution`/`seed`/`minMoves` (they're used only *during* generation,
 * and collapse into `hidden` + `optimal` here), so we don't ship them. See PLAN.md.
 *
 * Colors are stored as plain strings (the palette ids); the loader brands them back to the `Color`
 * type through the shared `toColor`/`toColors` factory (see `types.ts`). The board is the
 * generator-canonical layout (the app recolors it for display, like every freshly generated level).
 */
import type { Difficulty, Mechanic } from './types';

export interface BakedLevel {
  /** 1-based campaign level number. */
  level: number;
  /** Initial board, bottom-first, generator-canonical palette ids. */
  bottles: string[][];
  capacity: number;
  /** Concealment overlay parallel to `bottles` (all-false outside the hidden chapter). */
  hidden: boolean[][];
  /** Per-tube funnel tint (palette id), or null for an ordinary tube. All-null outside the funnel chapter. */
  funnels: (string | null)[];
  /** Per-cell ice trigger tint (palette id) parallel to `bottles`, or null. All-null outside the ice chapter. */
  ice: (string | null)[][];
  /** Exact (or proxy upper-bound) achievable optimal player pours — the 3★ cutoff. */
  optimal: number;
  /** 2★ ceiling: adjusted near-optimal band upper bound (always `> optimal`). See `stars.ts`. */
  twoStarMax: number;
  /** Difficulty signal shown to the player (bulk solution length). */
  par: number;
  phase: Difficulty;
  mechanics: Mechanic[];
}
