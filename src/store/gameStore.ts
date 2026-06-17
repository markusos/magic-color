/**
 * Zustand store: the bridge between the pure engine and the React UI. It owns the mutable
 * session state (current board, undo history, selection, status) and the player's campaign
 * position (which level), delegating every rule decision to the engine, every level recipe to
 * `progression`, and all persistence to the `campaign` service — the store itself never touches
 * localStorage.
 *
 * Progression is a single linear track: `level` is the player's global position and the board is
 * regenerated from it on demand. The reached level and best scores live in `campaign`, which the
 * store mirrors into its reactive fields (`furthest`, `best`, `bestStars`, `levelStars`).
 *
 * The board is only declared `deadlocked` when the player has NO legal move at all (a genuine
 * wall). We deliberately do NOT proactively detect "the board is no longer winnable but moves
 * remain" — getting stuck from an earlier mistake shouldn't end the game; the player keeps their
 * moves and can undo or restart at will.
 */
import { create } from 'zustand';
import { canPour, isWon, pour } from '../game/engine';
import { generateForLevel } from '../game/progression';
import { anyHidden, isCapped, knownTopRun, revealExposed, type HiddenGrid } from '../game/hidden';
import { recolor } from '../game/recolor';
import { starsFor, type Stars } from '../game/stars';
import type { Difficulty, GameState, Mechanic, Move } from '../game/types';
import { createCampaign } from './campaign';

export type GameStatus = 'playing' | 'won' | 'deadlocked';

/** Upper bound for the admin level-unlock hatch (see `unlockUpTo`). */
const MAX_UNLOCK_LEVEL = 1000;

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
   * Admin/testing hatch: raise the unlock frontier so every level up to `level` (clamped to
   * 1..1000) becomes playable. Never lowers progress, never touches earned stars/best scores.
   */
  unlockUpTo: (level: number) => void;
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
  // The persisted campaign — the sole owner of progress + localStorage.
  const campaign = createCampaign();

  /**
   * Commit a new board: set the synchronously-known status. On a win, record the best result for
   * the current level via the campaign and mirror it into the reactive fields.
   */
  const commit = (current: GameState, extra: Partial<GameStore>) => {
    const hidden = extra.hidden ?? get().hidden;
    const status = syncStatus(current, hidden);
    set({ current, status, ...extra });

    if (status === 'won') {
      const { level, moves, optimal } = get();
      const record = campaign.complete(level, moves.length, starsFor(moves.length, optimal));
      set({ ...record, levelStars: campaign.levelStars });
    }
  };

  const loadLevel = (level: number) => {
    const generated = generateForLevel(level);
    // Replaying an earlier level must not lower the unlock frontier.
    campaign.reach(level);
    // Display the board under a fresh random palette; keep `initial` in the generator's
    // canonical colors so each Restart re-rolls the hues (see `restart`).
    commit(recolor(generated.state), {
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
      ...campaign.recordFor(level),
      furthest: campaign.furthest,
      levelStars: campaign.levelStars,
    });
  };

  // Initial level: resume where the player left off. The displayed board gets fresh random
  // hues; `initial` stays canonical so Restart re-rolls them.
  const startLevel = campaign.furthest;
  const first = generateForLevel(startLevel);
  const firstBoard = recolor(first.state);

  return {
    current: firstBoard,
    initial: first.state,
    hidden: first.hidden,
    initialHidden: first.hidden,
    hiddenHistory: [],
    history: [],
    moves: [],
    selected: null,
    status: syncStatus(firstBoard, first.hidden),
    level: startLevel,
    phase: first.phase,
    mechanics: first.mechanics,
    optimal: first.optimal,
    ...campaign.recordFor(startLevel),
    furthest: campaign.furthest,
    levelStars: campaign.levelStars,

    loadLevel,
    nextLevel: () => loadLevel(get().level + 1),
    startOver: () => {
      campaign.reset();
      loadLevel(1);
    },

    unlockUpTo: (level) => {
      campaign.unlockTo(level, MAX_UNLOCK_LEVEL);
      set({ furthest: campaign.furthest });
    },

    tapBottle: (i) => {
      const { current, selected, status, hidden } = get();
      if (status !== 'playing') return;

      // A capped (finished) tube is inert: it can't be selected or poured from/into.
      const selectable = (b: number) =>
        current.bottles[b] !== undefined &&
        current.bottles[b].length > 0 &&
        !isCapped(current.bottles[b], current.capacity, hidden[b]);

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
      // Re-roll the palette on every restart: same layout, new colors.
      commit(recolor(get().initial), {
        history: [],
        hiddenHistory: [],
        hidden: get().initialHidden,
        moves: [],
        selected: null,
      });
    },
  };
});
