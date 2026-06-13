import { useGameStore } from '../../store/gameStore';
import { canPour } from '../../game/engine';
import { Bottle } from '../Bottle/Bottle';
import styles from './GameBoard.module.css';

/** The grid of bottles. Tap interaction is delegated to the store. */
export function GameBoard() {
  const current = useGameStore((s) => s.current);
  const selected = useGameStore((s) => s.selected);
  const tapBottle = useGameStore((s) => s.tapBottle);

  return (
    <div className={styles.board}>
      {current.bottles.map((bottle, i) => (
        <Bottle
          key={i}
          bottle={bottle}
          capacity={current.capacity}
          selected={selected === i}
          isTarget={selected !== null && selected !== i && canPour(current, selected, i)}
          onTap={() => tapBottle(i)}
        />
      ))}
    </div>
  );
}
