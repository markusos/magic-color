import { useEffect, useId, useRef } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import { ArrowUpFromLine, ArrowDownToLine } from 'lucide-react';
import type { Bottle as BottleData, Color } from '../../game/types';
import { cssColor, patternFor } from '../../theme/colors';
import { LiquidSegment } from '../LiquidSegment/LiquidSegment';
import styles from './Bottle.module.css';

interface Props {
  bottle: BottleData;
  capacity: number;
  /** Per-segment concealment (bottom-first), for the hidden-colors mechanic. */
  hidden?: boolean[];
  /** Funnel tint (funnel mechanic): the only color this tube accepts, or null for an ordinary tube. */
  funnel?: Color | null;
  /**
   * Per-segment ice (ice mechanic), bottom-first: the trigger tint while a cell is still FROZEN, or
   * null once thawed / never iced. Frozen cells form a contiguous block from the floor, all one tint.
   */
  frozen?: (Color | null)[];
  /** Finished-tube visual (full single color, revealed, thawed) — from the core's snapshot (F6). */
  capped: boolean;
  selected: boolean;
  /** Colorblind aid: overlay each color's distinct texture (liquids, funnel collar, ice badge). */
  patterns?: boolean;
  /**
   * This tube's role in a shown hint, or undefined: `'from'` (pour the liquid out of here) or `'to'`
   * (pour it into here). Drives the directional chip + pulse so the suggested move is unambiguous.
   */
  hintRole?: 'from' | 'to';
  /** Highlight as a valid pour target while another bottle is selected. */
  isTarget?: boolean;
  /** How far (px) the bottle lifts when selected; scales with bottle size. */
  lift: number;
  onTap: () => void;
}

/** Tube tilt when selected (deg) — must match the spring target in the effect below. */
const TILT_DEG = 6;
const SEG_ASPECT = 0.72; // segment height / bottle width, mirrors useBottleMetrics
const NECK_FACTOR = 0.4; // extra tube height (neck/base) in segments, mirrors useBottleMetrics

/**
 * Horizontal over-scale for the upright liquid block so it keeps covering the tilted glass
 * interior (the glass clips the overflow). The liquid counter-rotates to stay world-level while
 * the glass tilts by TILT_DEG, so the block has to widen by cos θ + aspect·sin θ to reach the
 * tilted corners. The aspect term means tall tubes need much more than short ones — a fixed scale
 * (e.g. 1.35, right for capacity 4) leaves the glass showing on capacity-10 tubes. Small margin
 * for the glass border. Excess width is clipped, so erring large is harmless.
 */
function coverScaleX(capacity: number): number {
  const tilt = (TILT_DEG * Math.PI) / 180;
  const aspect = SEG_ASPECT * (capacity + NECK_FACTOR);
  return Math.cos(tilt) + aspect * Math.sin(tilt) + 0.05;
}

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
const ICE_FACETS: readonly (readonly [string, 'A' | 'B' | 'C'])[] = [
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
const ICE_CRACKS: readonly string[] = [
  '0,0 60,30', '44,0 60,30', '84,0 60,30', '84,0 94,46', '128,0 94,46',
  '122,34 94,46', '128,72 94,46', '84,72 94,46', '84,72 60,30', '44,72 60,30',
  '44,72 34,44', '0,72 34,44', '6,38 34,44', '0,0 34,44', '60,30 94,46', '60,30 34,44',
];
// Frost bubbles trapped in the chunk (x, y, r).
const ICE_BUBBLES: readonly (readonly [number, number, number])[] = [
  [30, 40, 2], [88, 30, 1.4], [66, 56, 1.6], [22, 18, 1.1],
];
// Irregular crystalline crown, drawn in the topmost chunk's OWN coordinates (rising above its y=0 top
// edge) so it shares that chunk's single fill layer — no separate translucent overlay stacking on top of
// the chunk (which would darken the overlap into a broad horizontal band). Jagged peaks of varied
// height/spacing read as angular ice shards, not even teeth.
// Three spikes whose valleys (0/44/84/128) sit exactly on the block's top-edge crack endpoints, so each
// crack line continues straight up into a spike edge — one connected crystal from block to crown.
const ICE_CROWN: readonly (readonly [string, 'A' | 'B' | 'C'])[] = [
  ['0,0 22,-26 44,0 64,-34 84,0 106,-26 128,0', 'C'],
];
const ICE_CROWN_CRACKS: readonly string[] = [
  '0,0 22,-26', '22,-26 44,0', '44,0 64,-34', '64,-34 84,0', '84,0 106,-26', '106,-26 128,0',
];

/** A test tube of stacked liquid segments. Lifts and tilts slightly when selected. */
export function Bottle({ bottle, capacity, hidden, funnel, frozen, capped, selected, patterns, hintRole, isTarget, lift, onTap }: Props) {
  const segments = bottle.slice(0, capacity);
  // The frozen block is a contiguous run of cells from the floor, all sharing one trigger tint.
  const frozenCount = frozen ? frozen.filter((t) => t != null).length : 0;
  const iceTint = frozen?.find((t) => t != null) ?? null;
  const gid = useId(); // unique ids for this tube's ice facet gradients

  // Stagger a multi-band pour so the liquid rises bottom-to-top instead of every new band popping
  // in at once. Bands present before this render don't re-animate (AnimatePresence keeps them), so
  // we only delay the freshly added ones, stepped by how far above the previous fill line they are.
  const prevFillRef = useRef(segments.length);
  const prevFill = prevFillRef.current;
  useEffect(() => {
    prevFillRef.current = segments.length;
  }, [segments.length]);

  // One spring drives the tube's tilt; the liquid reads the exact negation every frame, so the
  // counter-rotation cancels the tilt perfectly throughout the animation (two independent springs
  // drift apart mid-transition and make the surface wobble). The liquid stays world-level.
  const tubeRotate = useMotionValue(0);
  const liquidRotate = useTransform(tubeRotate, (r) => -r);
  useEffect(() => {
    const controls = animate(tubeRotate, selected ? -TILT_DEG : 0, {
      type: 'spring',
      stiffness: 420,
      damping: 26,
    });
    return () => controls.stop();
  }, [selected, tubeRotate]);

  return (
    <motion.button
      type="button"
      className={`${styles.bottle} ${isTarget ? styles.target : ''} ${
        hintRole ? `${styles.hint} ${hintRole === 'from' ? styles.hintFrom : styles.hintTo}` : ''
      }`}
      onClick={onTap}
      aria-label={`bottle with ${bottle.length} of ${capacity} filled`}
      animate={{ y: selected ? -lift : 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      whileTap={{ scale: 0.96 }}
      style={{ height: `calc(var(--segment-height) * ${capacity} + var(--segment-height) * 0.4)` }}
    >
      {/* The tube tilts here (not on the button) so its rotation is a clean motion value the liquid
          can mirror — Framer's gesture/animate system on the button would otherwise override it. */}
      <motion.div className={styles.tube} style={{ rotate: tubeRotate }}>
        <div className={styles.glass}>
        {/* Counter-rotate the liquid against the tube's tilt so its surfaces stay level with the
            world — the tilt then reads as the liquid sloshing rather than the whole column
            rotating rigidly. `liquidRotate` is the exact negation of the tube's rotation (shared
            motion value), so it cancels at every instant with no wobble. The gap-covering scale
            lives on the inner element as plain CSS. */}
        <motion.div className={styles.liquidTilt} style={{ rotate: liquidRotate }}>
          <div
            className={styles.liquidColumn}
            style={{ transform: selected ? `scaleX(${coverScaleX(capacity)}) scaleY(1.05)` : undefined }}
          >
            <AnimatePresence initial={false}>
              {segments.map((color, i) => (
                <LiquidSegment
                  key={i}
                  color={color}
                  isBottom={i === 0}
                  isTop={i === segments.length - 1}
                  hidden={hidden?.[i]}
                  patterns={patterns}
                  fillDelay={i >= prevFill ? (i - prevFill) * 0.08 : 0}
                />
              ))}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Concealed "?" marks live here, in the tube's frame (not the counter-rotated liquid), so
            they stay centred on the tube's axis and tilt with it. Drawing them inside the liquid
            instead pins them to the liquid's vertical centre-line, which drifts off-axis as the
            tube tilts. Positioned by band index from the bottom. */}
        {segments.some((_, i) => hidden?.[i]) && (
          <div className={styles.marks} aria-hidden>
            {segments.map((_, i) =>
              hidden?.[i] ? (
                <span
                  key={i}
                  className={styles.mark}
                  style={{ bottom: `calc(${i} * var(--segment-height))` }}
                >
                  ?
                </span>
              ) : null,
            )}
          </div>
        )}

        {/* Funnel collar: a tinted ring at the tube neck marking the only color this tube accepts.
            Lives in the glass (clipped to the rim) and so tilts with the tube. Drawn above the liquid
            but it sits at the very top, where liquid only reaches once the tube is full. */}
        {funnel != null && (
          <div className={styles.funnel} aria-hidden style={{ ['--funnel' as string]: cssColor(funnel) }}>
            {/* Colorblind aid: the collar's accepted color also carries its texture, so which color a
                funnel locks to reads without hue. */}
            {patterns && <div className="cb-pattern" data-cb={patternFor(funnel)} aria-hidden />}
          </div>
        )}

        </div>

        {/* Ice: the frozen part of the tube encased in faceted crystalline ice. STACKED one tile per
            frozen segment (so it never distorts with the count) and SEMI-TRANSPARENT (the liquid colour
            shows through — never a second hidden state). Rendered in the tube frame, a touch wider than
            the glass so the ice grips the outside edges; a jagged crystalline surface crowns the top and
            the badge — centred on the block — names the trigger colour that thaws it. */}
        <AnimatePresence>
          {frozenCount > 0 && iceTint != null && (
            <motion.div
              key="ice"
              className={styles.iceFrost}
              aria-hidden
              style={{
                height: `calc(var(--segment-height) * ${frozenCount})`,
                ['--ice' as string]: cssColor(iceTint),
              }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05, y: 8 }}
              transition={{ duration: 0.38, ease: 'easeOut' }}
            >
              {/* Facet gradients: each face is faintly shaded (lit edge → cool edge) so the chunks
                  catch light, but kept LOW-opacity so the liquid colour reads clearly through the ice
                  (like the reference). The thin white crack strokes do most of the structural work. */}
              <svg className={styles.iceDefs} aria-hidden>
                <defs>
                  <linearGradient id={`iceA-${gid}`} x1="0" y1="0" x2="0.4" y2="1">
                    <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
                    <stop offset="1" stopColor="#cfeefc" stopOpacity="0.24" />
                  </linearGradient>
                  <linearGradient id={`iceB-${gid}`} x1="0" y1="0" x2="0.4" y2="1">
                    <stop offset="0" stopColor="#bfe6f7" stopOpacity="0.32" />
                    <stop offset="1" stopColor="#8cc4e6" stopOpacity="0.34" />
                  </linearGradient>
                  <linearGradient id={`iceC-${gid}`} x1="0" y1="0" x2="0.4" y2="1">
                    <stop offset="0" stopColor="#eaf8ff" stopOpacity="0.46" />
                    <stop offset="1" stopColor="#a9d8f1" stopOpacity="0.28" />
                  </linearGradient>
                </defs>
              </svg>

              {/* ONE continuous SVG for the whole frozen block — NOT one <svg> per segment. Stacking N
                  separate tiles meant each had a fractional (var(--segment-height)) height that iOS
                  WebKit snapped to the device-pixel grid independently; on any recomposite the rounded
                  edges drifted apart and visible GAPS opened between segments. A single element has no
                  internal element seams to gap: each chunk is just a <g> translated into its vertical
                  slot, and the cracks are authored to flow across the chunk boundaries as one crystal.
                  No `preserveAspectRatio="none"` / `non-scaling-stroke` either — both force per-raster
                  geometry recompute in device space (more sub-pixel jitter); the viewBox aspect equals
                  the block box so the default `meet` fits without distortion, and plain viewBox-unit
                  strokes scale with the tube so every repaint is pixel-deterministic. */}
              <svg
                className={styles.iceSheet}
                viewBox={`0 0 128 ${72 * frozenCount}`}
                aria-hidden
              >
                {Array.from({ length: frozenCount }, (_, k) => {
                  // k=0 is the topmost chunk. Slot it at y=72*k; mirror alternate chunks (by stack
                  // position from the floor) so the cracks meeting each seam land at different x.
                  const flip = (frozenCount - 1 - k) % 2 === 1;
                  const slot = flip
                    ? `translate(128,${72 * k}) scale(-1,1)`
                    : `translate(0,${72 * k})`;
                  return (
                    <g key={k} transform={slot}>
                      {ICE_FACETS.map(([pts, g], fi) => (
                        <polygon key={fi} points={pts} fill={`url(#ice${g}-${gid})`} />
                      ))}
                      <g stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" fill="none">
                        {ICE_CRACKS.map((pts, ci) => (
                          <polyline key={ci} points={pts} />
                        ))}
                      </g>
                      <g fill="rgba(255,255,255,0.4)">
                        {ICE_BUBBLES.map(([cx, cy, r], bi) => (
                          <circle key={bi} cx={cx} cy={cy} r={r} />
                        ))}
                      </g>
                      {/* A delicate snowflake etched on the face. */}
                      <g
                        stroke="rgba(255,255,255,0.6)"
                        strokeWidth="1.2"
                        fill="none"
                        transform="translate(94,34)"
                      >
                        <path d="M0,-8 V8 M-7,-4 L7,4 M-7,4 L7,-4" />
                      </g>
                      {/* The topmost chunk grows an irregular crown above its top edge (negative y) —
                          pokes above the viewBox via the sheet's `overflow: visible`. */}
                      {k === 0 && (
                        <>
                          {ICE_CROWN.map(([pts, g], ci) => (
                            <polygon key={`cf${ci}`} points={pts} fill={`url(#ice${g}-${gid})`} />
                          ))}
                          <g stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" fill="none">
                            {ICE_CROWN_CRACKS.map((pts, ci) => (
                              <polyline key={`cc${ci}`} points={pts} />
                            ))}
                          </g>
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* A single rainbow refraction streak across the whole block, tying the chunks into one
                  crystal. */}
              <div className={styles.iceRainbow} />

              <div className={styles.iceBadge}>
                ❄
                {/* Colorblind aid: the trigger-color swatch carries its texture too, so the "complete
                    THIS color" badge reads without hue. Clipped to the round badge. */}
                {patterns && (
                  <div className={`${styles.iceBadgePattern} cb-pattern`} data-cb={patternFor(iceTint)} aria-hidden />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {capped && (
          <motion.div
            className={styles.cap}
            initial={{ x: '-50%', y: -lift, opacity: 0, scale: 0.85 }}
            animate={{ x: '-50%', y: 0, opacity: 1, scale: 1 }}
            exit={{ x: '-50%', y: -lift, opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 600, damping: 22 }}
          />
        )}
      </AnimatePresence>

      {/* Hint direction chip floating above the tube: an "out" arrow on the source (pour FROM here),
          an "in" arrow on the destination (pour INTO here) — so the suggested move reads unambiguously. */}
      <AnimatePresence>
        {hintRole && (
          <motion.div
            key="hintChip"
            className={`${styles.hintChip} ${hintRole === 'from' ? styles.hintChipFrom : styles.hintChipTo}`}
            aria-hidden
            initial={{ opacity: 0, y: 6, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 24 }}
          >
            {hintRole === 'from' ? (
              <ArrowUpFromLine size={16} strokeWidth={2.5} />
            ) : (
              <ArrowDownToLine size={16} strokeWidth={2.5} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
