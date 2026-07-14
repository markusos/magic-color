import { useMemo, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { viewOf } from '../../store/session';
import { Bottle } from '../Bottle/Bottle';
import { useBottleMetrics } from './useBottleMetrics';
import styles from './GameBoard.module.css';

/** The grid of bottles, sized responsively to fit the viewport without scrolling. */
export function GameBoard() {
  const current = useGameStore((s) => s.current);
  const selected = useGameStore((s) => s.selected);
  const hidden = useGameStore((s) => s.hidden);
  const funnels = useGameStore((s) => s.funnels);
  const ice = useGameStore((s) => s.ice);
  const hint = useGameStore((s) => s.hint);
  const rejectedTube = useGameStore((s) => s.rejectedTube);
  const rejectedNonce = useGameStore((s) => s.rejectedNonce);
  const patterns = useSettings((s) => s.patterns);
  // Debug cheat (E4): draw concealed cells face-up. Render-only — the store still enforces concealment,
  // so gameplay is unchanged; this just stops passing the per-cell `hidden` mask to the bottles.
  const revealHidden = useSettings((s) => s.revealHidden);
  const tapBottle = useGameStore((s) => s.tapBottle);
  // Bumped on every level load / restart (never on a pour or undo). Folding it into the bottle
  // keys remounts the board on a fresh load, so the liquid fill animation is reserved for pours.
  const boardNonce = useGameStore((s) => s.boardNonce);

  const areaRef = useRef<HTMLDivElement>(null);
  const metrics = useBottleMetrics(areaRef, current.bottles.length, current.capacity);

  // The core's render snapshot (F6): per-cell frozen flags, per-tube capped flags, and the legal
  // pour targets from the current selection — one sync wasm call (4 encodes + 5 decodes across the
  // boundary), no rule logic in JS. The stuck check is skipped on this path (render must never pay
  // for a search). Memoized on its actual inputs so a re-render driven by an unrelated subscription
  // (a `patterns`/`revealHidden` toggle, or any field added here later) doesn't re-cross the
  // boundary; a normal tap changes `current`/`selected`, so it recomputes then as it must.
  const view = useMemo(
    () => viewOf(current, { hidden, funnels, ice }, selected),
    [current, hidden, funnels, ice, selected],
  );

  return (
    <div className={styles.boardArea} ref={areaRef}>
      <div
        className={styles.board}
        style={{
          gridTemplateColumns: `repeat(${metrics.columns}, ${metrics.width}px)`,
          columnGap: `${metrics.colGap}px`,
          rowGap: `${metrics.rowGap}px`,
          // Sizing vars consumed by Bottle / LiquidSegment.
          ['--bottle-width' as string]: `${metrics.width}px`,
          ['--segment-height' as string]: `${metrics.segmentHeight}px`,
        }}
      >
        {current.bottles.map((bottle, i) => (
          <Bottle
            key={`${boardNonce}-${i}`}
            bottle={bottle}
            capacity={current.capacity}
            hidden={revealHidden ? undefined : hidden[i]}
            funnel={funnels[i] ?? null}
            frozen={bottle.map((_, j) => (view.frozen[i]?.[j] ? (ice[i]?.[j] ?? null) : null))}
            capped={view.capped[i] ?? false}
            selected={selected === i}
            patterns={patterns}
            hintRole={hint?.from === i ? 'from' : hint?.to === i ? 'to' : undefined}
            isTarget={view.pourTargets[i] ?? false}
            lift={metrics.segmentHeight * 0.7}
            // Non-zero (and changing) only when THIS tube was the last illegal pour target — drives
            // the reject shake. Zero for every other tube, so an unrelated rejection never shakes it.
            shakeToken={rejectedTube === i ? rejectedNonce : 0}
            onTap={() => tapBottle(i)}
          />
        ))}
      </div>
    </div>
  );
}
