/**
 * Star rating for a solve. `optimal` is the level's achievable near-optimal player-pour count —
 * for small boards the EXACT hidden-aware minimum, for big Hard boards a tight upper bound (see
 * `optimalFor`/`optimalCappedMoves`). Because `optimal` already accounts for capping and hidden
 * cells, the rating is just a tolerance over it — no separate hidden margin needed.
 *
 *   3 stars — a close-to-perfect solve
 *   2 stars — at or near par
 *   1 star  — worse than par (just finishing)
 *
 * The two factors are the only difficulty dials. Note `optimal` assumes you know the board; a
 * first-time blind player on a hidden level pays an extra information cost that no board-derived
 * optimal can capture — the tolerance below is what absorbs it.
 */

/** A solve earns at most 3 and at least 1 star. */
export type Stars = 1 | 2 | 3;

/** 3 stars while moves stay within optimal x this. */
const THREE_STAR_FACTOR = 1.5;
/** "Par": 2 stars while moves stay within optimal x this; beyond it is 1 star. */
const PAR_FACTOR = 2;

/** Stars earned for solving in `moves`, given the level's `optimal` reference. */
export function starsFor(moves: number, optimal: number): Stars {
  if (moves <= Math.round(optimal * THREE_STAR_FACTOR)) return 3;
  if (moves <= Math.round(optimal * PAR_FACTOR)) return 2;
  return 1;
}
