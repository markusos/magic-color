/**
 * Static SVG geometry for the ice mechanic's frozen-block art — extracted from `Bottle.tsx` so the
 * component reads as component logic, not ~100 lines of authored polygon tables. Pure data (plus its
 * authoring rationale); the `Bottle` render maps over these to draw one crystalline chunk per frozen
 * segment. Coordinates live in a 128×72 per-chunk box (see `ICE_FACETS`).
 */

/**
 * Geometry for ONE stacked ice chunk, in a 128×72 box. That box is square-scaled: the frost holder is
 * 128% of the tube wide and each chunk is one segment (0.72 × tube) tall, so 1 unit = 1% of tube width
 * on both axes — the chunk renders with `preserveAspectRatio="none"` but never actually distorts, and N
 * chunks stack to exactly match the frozen block. The chunk fills its whole box with translucent facets
 * (so the liquid reads through); only the DIAGONAL crack edges are stroked, never the horizontal box
 * edges, so a stack reads as one fractured crystal instead of banded layers. Alternate chunks mirror
 * horizontally, so the cracks meeting each seam land at different x on either side (a crystal fault, not
 * a clean line). Facets fan from three off-centre hubs P/Q/R for an irregular low-poly look.
 */
export const ICE_FACETS: readonly (readonly [string, 'A' | 'B' | 'C'])[] = [
  ['0,0 44,0 60,30', 'A'],
  ['44,0 84,0 60,30', 'C'],
  ['84,0 94,46 60,30', 'C'],
  ['84,0 128,0 94,46', 'C'],
  ['128,0 122,34 94,46', 'B'],
  ['122,34 128,72 94,46', 'B'],
  ['128,72 84,72 94,46', 'B'],
  ['84,72 60,30 94,46', 'B'],
  ['84,72 44,72 60,30', 'C'],
  ['44,72 34,44 60,30', 'C'],
  ['44,72 0,72 34,44', 'B'],
  ['0,72 6,38 34,44', 'A'],
  ['6,38 0,0 34,44', 'A'],
  ['0,0 60,30 34,44', 'A'],
];
// Only the diagonal facet edges (no horizontal box edges) — these are the visible cracks. Their top-edge
// endpoints (0/44/84/128) match the crown's base points so each crack flows straight up into a spike,
// and match the bottom-edge points (also 44/84) so cracks connect across chunk seams. The pinched side
// points (6,38)/(122,34) keep the stacked column's edges from reading as two dead-straight lines.
export const ICE_CRACKS: readonly string[] = [
  '0,0 60,30',
  '44,0 60,30',
  '84,0 60,30',
  '84,0 94,46',
  '128,0 94,46',
  '122,34 94,46',
  '128,72 94,46',
  '84,72 94,46',
  '84,72 60,30',
  '44,72 60,30',
  '44,72 34,44',
  '0,72 34,44',
  '6,38 34,44',
  '0,0 34,44',
  '60,30 94,46',
  '60,30 34,44',
];
// Frost bubbles trapped in the chunk (x, y, r).
export const ICE_BUBBLES: readonly (readonly [number, number, number])[] = [
  [30, 40, 2],
  [88, 30, 1.4],
  [66, 56, 1.6],
  [22, 18, 1.1],
];
// Irregular crystalline crown, drawn in the topmost chunk's OWN coordinates (rising above its y=0 top
// edge) so it shares that chunk's single fill layer — no separate translucent overlay stacking on top of
// the chunk (which would darken the overlap into a broad horizontal band). Jagged peaks of varied
// height/spacing read as angular ice shards, not even teeth.
// Three spikes whose valleys (0/44/84/128) sit exactly on the block's top-edge crack endpoints, so each
// crack line continues straight up into a spike edge — one connected crystal from block to crown.
export const ICE_CROWN: readonly (readonly [string, 'A' | 'B' | 'C'])[] = [
  ['0,0 22,-26 44,0 64,-34 84,0 106,-26 128,0', 'C'],
];
export const ICE_CROWN_CRACKS: readonly string[] = [
  '0,0 22,-26',
  '22,-26 44,0',
  '44,0 64,-34',
  '64,-34 84,0',
  '84,0 106,-26',
  '106,-26 128,0',
];
