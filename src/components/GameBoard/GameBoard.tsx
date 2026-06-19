import { useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { canPour } from '../../game/engine';
import { Bottle } from '../Bottle/Bottle';
import { useBottleMetrics } from './useBottleMetrics';
import styles from './GameBoard.module.css';

/** The grid of bottles, sized responsively to fit the viewport without scrolling. */
export function GameBoard() {
  const current = useGameStore((s) => s.current);
  const selected = useGameStore((s) => s.selected);
  const hidden = useGameStore((s) => s.hidden);
  const tapBottle = useGameStore((s) => s.tapBottle);
  // Bumped on every level load / restart (never on a pour or undo). Folding it into the bottle
  // keys remounts the board on a fresh load, so the liquid fill animation is reserved for pours.
  const boardNonce = useGameStore((s) => s.boardNonce);

  const areaRef = useRef<HTMLDivElement>(null);
  const metrics = useBottleMetrics(areaRef, current.bottles.length, current.capacity);

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
            selected={selected === i}
            isTarget={selected !== null && selected !== i && canPour(current, selected, i)}
            lift={metrics.segmentHeight * 0.7}
            onTap={() => tapBottle(i)}
          />
        ))}
      </div>
    </div>
  );
}
