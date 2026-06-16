/**
 * Zustand store: the bridge between the pure engine and the React UI. It owns the mutable
 * session state (current board, undo history, selection, status) and the player's campaign
 * position (which level), delegating every rule decision to the engine and every level recipe
 * to `progression`.
 *
 * Progression is a single linear track: `level` is the player's global position, the board is
 * regenerated from it on demand, and the reached level + best scores are persisted to
 * localStorage.
 *
 * Deadlock detection is split by cost: a win and the cheap "zero legal moves" case are decided
 * synchronously for instant feedback, while the expensive "stuck loop" proof runs debounced in
 * a Web Worker via the deadlock monitor, flipping the status to `deadlocked` only once it returns.
 */
import { create } from 'zustand';
import { canPour, isWon, pour } from '../game/engine';
import { generateForLevel } from '../game/progression';
import { anyHidden, isCapped, knownTopRun, revealExposed, type HiddenGrid } from '../game/hidden';
import { starsFor, type Stars } from '../game/stars';
import type { Difficulty, GameState, Mechanic, Move } from '../game/types';
import { createDeadlockMonitor, type DeadlockMonitor } from './deadlockMonitor';
import { clearProgress, loadProgress, recordResult, saveProgress, type Progress } from './progress';

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
  /** Concealment overlay for the live board (hidden-colors mechanic; all-false otherwise). */
  hidden: HiddenGrid;
  /** The level's starting concealment, for Restart. */
  initialHidden: HiddenGrid;
  /** Concealment snapshots before each pour, mirroring `history` for undo. */
  hiddenHistory: HiddenGrid[];
  /** Currently selected source bottle, or null. */
  selected: number | null;
  status: GameStatus;
  /** The player's global campaign position (1-based). */
  level: number;
  /** Difficulty phase label for the current level (derived from the level number). */
  phase: Difficulty;
  /** Board mechanics active this level (empty in chapter 0). */
  mechanics: readonly Mechanic[];
  /** Achievable near-optimal move count for the current level — basis for the star rating. */
  optimal: number;
  /** The player's best (fewest) moves for the current level, or null if never solved. */
  best: number | null;
  /** The player's best star rating for the current level, or null if never solved. */
  bestStars: Stars | null;
  /** Highest level reached (the unlock frontier) — the level selector lists 1..furthest. */
  furthest: number;
  /** Best star rating per reached level, for the level selector. */
  levelStars: Record<number, Stars>;

  /** Load a specific level into play (regenerates its board) and persist it as reached. */
  loadLevel: (level: number) => void;
  /** Advance to the next level. */
  nextLevel: () => void;
  /** Wipe saved progress and return to level 1. */
  startOver: () => void;
  /**
   * Handle a tap on bottle `i`. First tap selects a non-empty bottle; a second tap either
   * pours (if legal), reselects, or deselects.
   */
  tapBottle: (i: number) => void;
  undo: () => void;
  restart: () => void;
}

/**
 * Whether the player has no legal pour. Cap-aware: a capped (finished) tube can't be a source,
 * so its pours don't count as escape moves — the check mirrors exactly what the player can do.
 * (The expensive "stuck loop" case stays full-information in the worker; that's provably
 * cap-equivalent, since a completed tube holds all of its color and is never needed to win —
 * see the regression test in solver.test.ts.)
 */
function noPlayerMove(state: GameState, hidden: HiddenGrid): boolean {
  const n = state.bottles.length;
  for (let from = 0; from < n; from++) {
    const src = state.bottles[from]!;
    if (src.length === 0 || isCapped(src, state.capacity, hidden[from])) continue;
    for (let to = 0; to < n; to++) {
      if (from !== to && canPour(state, from, to)) return false;
    }
  }
  return true;
}

/**
 * Status we can decide instantly: a win, or a board where the player has no legal move. A board
 * only counts as won once every bottle is sorted AND no concealed cell remains — a tube that
 * still holds a "?" isn't finished, even if its real colors already match.
 */
function syncStatus(state: GameState, hidden: HiddenGrid): GameStatus {
  if (isWon(state) && !anyHidden(hidden)) return 'won';
  if (!isWon(state) && noPlayerMove(state, hidden)) return 'deadlocked';
  return 'playing';
}

export const useGameStore = create<GameStore>((set, get) => {
  // The player's persisted campaign progress, kept in sync with the store.
  let progress: Progress = loadProgress();

  /**
   * Commit a new board: set the synchronously-known status, then (if still playing) schedule
   * the debounced worker check for the harder "stuck loop" case. On a win, record the best
   * move count for the current level.
   */
  const commit = (current: GameState, extra: Partial<GameStore>) => {
    const hidden = (extra.hidden ?? get().hidden) as HiddenGrid;
    const status = syncStatus(current, hidden);
    set({ current, status, ...extra });

    if (status === 'won') {
      const { level, moves, optimal } = get();
      const stars = starsFor(moves.length, optimal);
      progress = recordResult(progress, level, moves.length, stars);
      saveProgress(progress);
      set({
        best: progress.best[level] ?? null,
        bestStars: progress.stars[level] ?? null,
        levelStars: progress.stars,
      });
    }

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

  const loadLevel = (level: number) => {
    const generated = generateForLevel(level);
    // Replaying an earlier level must not lower the unlock frontier.
    progress = { ...progress, current: Math.max(progress.current, level) };
    saveProgress(progress);
    commit(generated.state, {
      initial: generated.state,
      hidden: generated.hidden,
      initialHidden: generated.hidden,
      hiddenHistory: [],
      history: [],
      moves: [],
      selected: null,
      level,
      phase: generated.phase,
      mechanics: generated.mechanics,
      optimal: generated.optimal,
      best: progress.best[level] ?? null,
      bestStars: progress.stars[level] ?? null,
      furthest: progress.current,
      levelStars: progress.stars,
    });
  };

  // Initial level: resume where the player left off.
  const first = generateForLevel(progress.current);

  return {
    current: first.state,
    initial: first.state,
    hidden: first.hidden,
    initialHidden: first.hidden,
    hiddenHistory: [],
    history: [],
    moves: [],
    selected: null,
    status: syncStatus(first.state, first.hidden),
    level: progress.current,
    phase: first.phase,
    mechanics: first.mechanics,
    optimal: first.optimal,
    best: progress.best[progress.current] ?? null,
    bestStars: progress.stars[progress.current] ?? null,
    furthest: progress.current,
    levelStars: progress.stars,

    loadLevel,
    nextLevel: () => loadLevel(get().level + 1),
    startOver: () => {
      clearProgress();
      progress = loadProgress();
      loadLevel(1);
    },

    tapBottle: (i) => {
      const { current, selected, status, hidden } = get();
      if (status !== 'playing') return;

      // A capped (finished) tube is inert: it can't be selected or poured from/into.
      const selectable = (b: number) =>
        current.bottles[b] !== undefined &&
        current.bottles[b]!.length > 0 &&
        !isCapped(current.bottles[b]!, current.capacity, hidden[b]);

      // No current selection: select a non-empty, un-capped bottle.
      if (selected === null) {
        if (selectable(i)) set({ selected: i });
        return;
      }

      // Tapping the selected bottle again deselects it.
      if (selected === i) {
        set({ selected: null });
        return;
      }

      // Attempt a pour from the selected bottle to the tapped one. Concealed cells block the
      // visible run, so cap the pour at what the player can actually see.
      if (canPour(current, selected, i)) {
        const cap = knownTopRun(current.bottles[selected]!, hidden[selected]);
        const { state: next, move } = pour(current, selected, i, cap);
        commit(next, {
          history: [...get().history, current],
          hiddenHistory: [...get().hiddenHistory, hidden],
          hidden: revealExposed(next, hidden),
          moves: [...get().moves, move],
          selected: null,
        });
        return;
      }

      // Illegal pour: switch the selection to the newly tapped bottle if it's selectable,
      // otherwise just clear the selection.
      if (selectable(i)) {
        set({ selected: i });
      } else {
        set({ selected: null });
      }
    },

    undo: () => {
      const { history, hiddenHistory, moves } = get();
      if (history.length === 0) return;
      const previous = history[history.length - 1]!;
      commit(previous, {
        history: history.slice(0, -1),
        hiddenHistory: hiddenHistory.slice(0, -1),
        hidden: hiddenHistory[hiddenHistory.length - 1]!,
        moves: moves.slice(0, -1),
        selected: null,
      });
    },

    restart: () => {
      commit(get().initial, {
        history: [],
        hiddenHistory: [],
        hidden: get().initialHidden,
        moves: [],
        selected: null,
      });
    },
  };
});
