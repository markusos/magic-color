import { useEffect, useId, useRef } from 'react';
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'framer-motion';
import { ArrowUpFromLine, ArrowDownToLine, Funnel } from 'lucide-react';
import type { Bottle as BottleData, Color } from '../../game/types';
import { cssColor, patternFor } from '../../theme/colors';
import { LiquidSegment } from '../LiquidSegment/LiquidSegment';
import { ICE_BUBBLES, ICE_CRACKS, ICE_CROWN, ICE_CROWN_CRACKS, ICE_FACETS } from './iceGeometry';
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
  /**
   * Change signal for the "illegal pour target" shake (U7): a non-zero value that CHANGES plays one
   * shake. Zero (or unchanged) plays nothing, so only the rejected tube reacts. See {@link GameBoard}.
   */
  shakeToken?: number;
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

/** A test tube of stacked liquid segments. Lifts and tilts slightly when selected. */
export function Bottle({
  bottle,
  capacity,
  hidden,
  funnel,
  frozen,
  capped,
  selected,
  patterns,
  hintRole,
  isTarget,
  lift,
  shakeToken,
  onTap,
}: Props) {
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

  // Reject shake (U7): a quick side-to-side jitter of the whole tube when it was tapped as an illegal
  // pour target. Driven by `shakeToken` changing to a non-zero value; the amplitude scales with the
  // tube so tiny boards don't over-swing. Skipped under reduced-motion. `shakeX` translates the tube
  // (glass + liquid together), independent of the tilt rotation, so the two never fight.
  const reduceMotion = useReducedMotion();
  const shakeX = useMotionValue(0);
  useEffect(() => {
    if (!shakeToken || reduceMotion) return;
    const amp = Math.max(3, lift * 0.24);
    const controls = animate(shakeX, [0, -amp, amp, -amp * 0.7, amp * 0.7, -amp * 0.4, 0], {
      duration: 0.4,
      ease: 'easeInOut',
    });
    return () => controls.stop();
  }, [shakeToken, reduceMotion, lift, shakeX]);

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
      <motion.div className={styles.tube} style={{ rotate: tubeRotate, x: shakeX }}>
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

          {/* Funnel collar: a tinted band at the tube neck marking the only color this tube accepts,
            capped by a crisp "lock line" at its base. Lives in the glass (clipped to the rim) and so
            tilts with the tube. Hidden once the tube is capped — a finished tube's lock is moot. */}
          {funnel != null && !capped && (
            <div className={styles.funnel} aria-hidden style={{ ['--funnel' as string]: cssColor(funnel) }}>
              {/* Colorblind aid: the collar's accepted color also carries its texture, so which color a
                funnel locks to reads without hue. */}
              {patterns && <div className="cb-pattern" data-cb={patternFor(funnel)} aria-hidden />}
            </div>
          )}
        </div>

        {/* Funnel badge: a color chip with a funnel glyph seated on the neck — the unambiguous "this
            tube only accepts THIS color" cue, echoing the ice badge. Drawn in the tube frame (a sibling
            of the glass, so unclipped by the rim) and tilts with the tube. */}
        {funnel != null && !capped && (
          <div
            className={styles.funnelBadge}
            aria-hidden
            style={{ ['--funnel' as string]: cssColor(funnel) }}
          >
            <Funnel size={14} strokeWidth={2.5} aria-hidden />
            {/* Colorblind aid: the swatch carries its texture too, so the lock color reads without hue. */}
            {patterns && (
              <div
                className={`${styles.funnelBadgePattern} cb-pattern`}
                data-cb={patternFor(funnel)}
                aria-hidden
              />
            )}
          </div>
        )}

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
              <svg className={styles.iceSheet} viewBox={`0 0 128 ${72 * frozenCount}`} aria-hidden>
                {Array.from({ length: frozenCount }, (_, k) => {
                  // k=0 is the topmost chunk. Slot it at y=72*k; mirror alternate chunks (by stack
                  // position from the floor) so the cracks meeting each seam land at different x.
                  const flip = (frozenCount - 1 - k) % 2 === 1;
                  const slot = flip ? `translate(128,${72 * k}) scale(-1,1)` : `translate(0,${72 * k})`;
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
                  <div
                    className={`${styles.iceBadgePattern} cb-pattern`}
                    data-cb={patternFor(iceTint)}
                    aria-hidden
                  />
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
