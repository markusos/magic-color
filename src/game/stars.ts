/**
 * Star rating for a solve, driven by the level's offline-computed solution structure. The bake (via
 * `nearOptimalCutoffs`) knows each board's EXACT optimal player-pour count and the adjusted ceiling
 * of the near-optimal band (`twoStarMax`) — the second distinct achievable solution length above
 * optimal. The rating is then exact, not a tolerance fudge:
 *
 *   3 stars — a perfect solve: exactly the optimal number of pours
 *   2 stars — within the adjusted near-optimal band (≈1–2 steps off optimal, snapped to what the
 *             board actually offers)
 *   1 star  — any solve beyond that (just finishing)
 *
 * `optimal` is the hidden-aware minimum on small boards and a tight upper bound on the few big Hard
 * boards the exact search can't crack (see `optimalCappedMoves`/`nearOptimalCutoffs`); on those
 * `twoStarMax` falls back to `optimal + 2`, so the band stays meaningful either way.
 */

/** A solve earns at most 3 and at least 1 star. */
export type Stars = 1 | 2 | 3;

/**
 * Stars earned for solving in `moves`, given the level's `optimal` (3★ cutoff) and `twoStarMax`
 * (2★ ceiling). A solve at or under optimal is perfect (3★) — clamping handles the in-progress
 * projection, which starts at 0 moves and so reads as 3★ until the player exceeds optimal.
 */
export function starsFor(moves: number, optimal: number, twoStarMax: number): Stars {
  if (moves <= optimal) return 3;
  if (moves <= twoStarMax) return 2;
  return 1;
}
