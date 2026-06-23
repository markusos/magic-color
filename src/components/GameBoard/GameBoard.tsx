import { useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { canPour, topColor } from '../../game/engine';
import { acceptsPour } from '../../game/mechanics';
import { frozenCells } from '../../game/ice';
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
  const tapBottle = useGameStore((s) => s.tapBottle);
  // Bumped on every level load / restart (never on a pour or undo). Folding it into the bottle
  // keys remounts the board on a fresh load, so the liquid fill animation is reserved for pours.
  const boardNonce = useGameStore((s) => s.boardNonce);

  const areaRef = useRef<HTMLDivElement>(null);
  const metrics = useBottleMetrics(areaRef, current.bottles.length, current.capacity);

  // Which cells are CURRENTLY frozen (derived from the board: a cell thaws once its trigger color is
  // capped). Cheap, and all-false when the board carries no ice, so non-ice chapters are unaffected.
  const frozenGrid = frozenCells(current, hidden, ice);

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
            hidden={hidden[i]}
            funnel={funnels[i] ?? null}
            frozen={bottle.map((_, j) => (frozenGrid[i]?.[j] ? (ice[i]?.[j] ?? null) : null))}
            selected={selected === i}
            isTarget={
              selected !== null &&
              selected !== i &&
              canPour(current, selected, i) &&
              acceptsPour({ hidden, funnels, ice }, i, topColor(current.bottles[selected]!)!)
            }
            lift={metrics.segmentHeight * 0.7}
            onTap={() => tapBottle(i)}
          />
        ))}
      </div>
    </div>
  );
}
