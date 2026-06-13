import { useGameStore } from '../../store/gameStore';
import type { Difficulty } from '../../game/types';
import styles from './Toolbar.module.css';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  normal: 'Normal',
  hard: 'Hard',
  superHard: 'Super Hard',
};

/** Game controls: difficulty + the magic toolbox (undo, add tube, restart, new). */
export function Toolbar() {
  const undo = useGameStore((s) => s.undo);
  const restart = useGameStore((s) => s.restart);
  const addEmptyTube = useGameStore((s) => s.addEmptyTube);
  const newGame = useGameStore((s) => s.newGame);
  const difficulty = useGameStore((s) => s.difficulty);
  const moves = useGameStore((s) => s.moves);
  const par = useGameStore((s) => s.par);
  const status = useGameStore((s) => s.status);

  return (
    <div className={styles.toolbar}>
      <div className={styles.stats}>
        <span className={styles.stat}>
          Moves <b>{moves.length}</b>
        </span>
        <span className={styles.stat}>
          Par <b>{par}</b>
        </span>
      </div>

      <div className={styles.tools}>
        <button onClick={undo} disabled={moves.length === 0} title="Undo">
          ↩ Undo
        </button>
        <button onClick={addEmptyTube} disabled={status !== 'playing'} title="Add an empty tube">
          ＋ Tube
        </button>
        <button onClick={restart} title="Restart this level">
          ⟳ Restart
        </button>
      </div>

      <div className={styles.difficulty}>
        {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => (
          <button
            key={d}
            className={d === difficulty ? styles.active : ''}
            onClick={() => newGame(d)}
          >
            {DIFFICULTY_LABELS[d]}
          </button>
        ))}
      </div>
    </div>
  );
}
