/**
 * Star rating for a solve. `optimal` is the achievable near-optimal move count for the level
 * (the stored solution replayed under the real capped/reveal rules — see `cappedSolveMoves`).
 *
 *   3 stars — a close-to-perfect solve (at or just over optimal)
 *   2 stars — at or near par
 *   1 star  — worse than par (just finishing)
 *
 * "Par" here is a small multiple of optimal; the two factors below are the only difficulty
 * dials. 3 stars is always achievable: replaying the reference solve lands at `optimal`, which
 * is within the 3-star cutoff on every level.
 */

/** A solve earns at most 3 and at least 1 star. */
export type Stars = 1 | 2 | 3;

/** 3 stars while moves stay within optimal x this. */
const THREE_STAR_FACTOR = 1.1;
/** "Par": 2 stars while moves stay within optimal x this; beyond it is 1 star. */
const PAR_FACTOR = 1.5;

/** Stars earned for solving in `moves`, given the level's `optimal` reference. */
export function starsFor(moves: number, optimal: number): Stars {
  if (moves <= Math.round(optimal * THREE_STAR_FACTOR)) return 3;
  if (moves <= Math.round(optimal * PAR_FACTOR)) return 2;
  return 1;
}
