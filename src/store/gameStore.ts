/**
 * Zustand store: the bridge between the pure engine and the React UI. It owns the
 * mutable session state (current board, undo history, selection, status) and delegates
 * every rule decision to the engine — no game logic lives here.
 *
 * Deadlock detection is split by cost: a win and the cheap "zero legal moves" case are
 * decided synchronously for instant feedback, while the expensive "stuck loop" proof
 * (moves remain but none can win) runs debounced in a Web Worker via the deadlock
 * monitor, flipping the status to `deadlocked` only once it returns.
 */
import { create } from 'zustand';
import { canPour, isDeadlocked, isWon, pour } from '../game/engine';
import { createLevel } from '../game/levels';
import type { Difficulty, GameState, Move } from '../game/types';
import { createDeadlockMonitor, type DeadlockMonitor } from './deadlockMonitor';

export type GameStatus = 'playing' | 'won' | 'deadlocked';

// A single monitor for the app. Swappable so tests can inject a fast, synchronous one.
let monitor: DeadlockMonitor = createDeadlockMonitor();

/** Test seam: replace the deadlock monitor (e.g. zero-debounce, in-process). */
export function __setDeadlockMonitor(next: DeadlockMonitor): void {
  monitor.dispose();
  monitor = next;
}

interface GameStore {
  /** The active board. */
  current: GameState;
  /** Snapshots before each pour, enabling unlimited undo. */
  history: GameState[];
  /** Moves applied so far this attempt. */
  moves: Move[];
  /** The board the level started from, for Restart. */
  initial: GameState;
  /** Currently selected source bottle, or null. */
  selected: number | null;
  status: GameStatus;
  difficulty: Difficulty;
  seed: number;
  /** Minimum moves of the generated solution, for the move counter / par. */
  par: number;

  /** Start a fresh level for the given difficulty (random seed unless provided). */
  newGame: (difficulty?: Difficulty, seed?: number) => void;
  /**
   * Handle a tap on bottle `i`. First tap selects a non-empty bottle; a second tap
   * either pours (if legal), reselects, or deselects.
   */
  tapBottle: (i: number) => void;
  undo: () => void;
  restart: () => void;
  /** Toolbox: add an empty tube to create breathing room. */
  addEmptyTube: () => void;
}

/** Status we can decide instantly: a win, or a board with no legal move at all. */
function syncStatus(state: GameState): GameStatus {
  if (isWon(state)) return 'won';
  if (isDeadlocked(state)) return 'deadlocked';
  return 'playing';
}

export const useGameStore = create<GameStore>((set, get) => {
  /**
   * Commit a new board: set the synchronously-known status, then (if still playing)
   * schedule the debounced worker check for the harder "stuck loop" case.
   */
  const commit = (current: GameState, extra: Partial<GameStore>) => {
    const status = syncStatus(current);
    set({ current, status, ...extra });

    if (status === 'playing') {
      monitor.schedule(current, (unsolvable) => {
        // Guard against races: only act if this board is still the live, playing one.
        if (unsolvable && get().current === current && get().status === 'playing') {
          set({ status: 'deadlocked' });
        }
      });
    } else {
      monitor.cancel();
    }
  };

  const loadLevel = (difficulty: Difficulty, seed?: number) => {
    const level = createLevel(difficulty, seed);
    commit(level.state, {
      initial: level.state,
      history: [],
      moves: [],
      selected: null,
      difficulty,
      seed: level.seed,
      par: level.minMoves,
    });
  };

  // Initial level.
  const first = createLevel('normal', 1);

  return {
    current: first.state,
    initial: first.state,
    history: [],
    moves: [],
    selected: null,
    status: syncStatus(first.state),
    difficulty: 'normal',
    seed: first.seed,
    par: first.minMoves,

    newGame: (difficulty, seed) => {
      loadLevel(difficulty ?? get().difficulty, seed);
    },

    tapBottle: (i) => {
      const { current, selected, status } = get();
      if (status !== 'playing') return;

      // No current selection: select a non-empty bottle.
      if (selected === null) {
        if (current.bottles[i] && current.bottles[i]!.length > 0) {
          set({ selected: i });
        }
        return;
      }

      // Tapping the selected bottle again deselects it.
      if (selected === i) {
        set({ selected: null });
        return;
      }

      // Attempt a pour from the selected bottle to the tapped one.
      if (canPour(current, selected, i)) {
        const { state: next, move } = pour(current, selected, i);
        commit(next, {
          history: [...get().history, current],
          moves: [...get().moves, move],
          selected: null,
        });
        return;
      }

      // Illegal pour: switch the selection to the newly tapped bottle if it has liquid,
      // otherwise just clear the selection.
      if (current.bottles[i] && current.bottles[i]!.length > 0) {
        set({ selected: i });
      } else {
        set({ selected: null });
      }
    },

    undo: () => {
      const { history, moves } = get();
      if (history.length === 0) return;
      const previous = history[history.length - 1]!;
      commit(previous, {
        history: history.slice(0, -1),
        moves: moves.slice(0, -1),
        selected: null,
      });
    },

    restart: () => {
      commit(get().initial, { history: [], moves: [], selected: null });
    },

    addEmptyTube: () => {
      const { current, status } = get();
      if (status !== 'playing') return;
      const next: GameState = { ...current, bottles: [...current.bottles, []] };
      // Pushing onto history lets the player undo the extra tube too.
      commit(next, { history: [...get().history, current], selected: null });
    },
  };
});
