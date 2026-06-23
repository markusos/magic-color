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
 * The board is declared `deadlocked` when the player has NO legal move at all (a genuine wall),
 * and `stuck` when moves remain but every reachable board has already been seen this attempt — the
 * player is provably going in circles (see `isStuckInLoop`). We deliberately do NOT fire on the
 * broader "no longer winnable but fresh states remain" condition: a mistake shouldn't end the game
 * while there's still somewhere new to explore — only once they're looping with nowhere to go.
 */
import { create } from 'zustand';
import { canPour, isWon, pour, topColor } from '../game/engine';
import { canonical, isStuckInLoop } from '../game/solver';
import { DEFAULT_CAPACITY } from '../game/generator';
import { BAKED_LEVEL_COUNT, generateRandomLevel, getLevel, hasBakedLevel } from '../game/levelLoader';
import { mechanicsForLevel, phaseForLevel, type PlayableLevel } from '../game/progression';
import { anyHidden, isCapped, knownTopRun, revealExposed, type HiddenGrid } from '../game/hidden';
import { funnelAccepts, type FunnelGrid } from '../game/funnels';
import { anyFrozen, blockedColumns, type IceGrid } from '../game/ice';
import { recolorBoard } from '../game/recolor';
import { shuffleBottles } from '../game/shuffle';
import { starsFor, type Stars } from '../game/stars';
import type { Difficulty, GameState, Mechanic, Move } from '../game/types';
import { createCampaign } from './campaign';
import { deferAfterPaint } from './deferAfterPaint';

export type GameStatus = 'playing' | 'won' | 'deadlocked' | 'stuck';

/** Campaign play (the numbered track) vs. the post-campaign "Random" challenge. */
export type GameMode = 'campaign' | 'endless';

/** Upper bound for the admin level-unlock hatch (see `unlockUpTo`) — the full baked campaign. */
const MAX_UNLOCK_LEVEL = BAKED_LEVEL_COUNT;

interface GameStore {
  /** The active board. */
  current: GameState;
  /** Snapshots before each pour, enabling unlimited undo. */
  history: GameState[];
  /** Moves applied so far this attempt. */
  moves: Move[];
  /** Undos used this attempt. Counts toward the star metric (`moves.length + undos`) — undoing costs rating. */
  undos: number;
  /**
   * Canonical keys of every board seen this attempt, kept monotonically across undo (so re-treading
   * a branch still reads as circling) and reset only on a fresh board / restart. Drives the `stuck`
   * "going in circles" detection. Not React-reactive — read only inside the store.
   */
  visited: Set<string>;
  /** The board the level started from, for Restart. */
  initial: GameState;
  /** Concealment overlay for the live board (hidden-colors mechanic; all-false otherwise). */
  hidden: HiddenGrid;
  /** The level's starting concealment, for Restart. */
  initialHidden: HiddenGrid;
  /**
   * Per-tube funnel tints (funnel mechanic; all-null otherwise). Static for the whole attempt — a
   * tube's tint never changes — so, unlike `hidden`, there's no per-pour history to snapshot. Carried
   * in display (recolored) ids, parallel to `current.bottles`.
   */
  funnels: FunnelGrid;
  /** The level's starting funnels (generator-canonical ids), for Restart's re-roll. */
  initialFunnels: FunnelGrid;
  /**
   * Per-cell ice trigger tints (ice mechanic; all-null otherwise). Static for the whole attempt — the
   * grid never changes; whether a cell is *currently* frozen is DERIVED from the board (a cell thaws
   * once its trigger color is capped), so there's no per-pour history to snapshot. Carried in display
   * (recolored) ids, parallel to `current.bottles`.
   */
  ice: IceGrid;
  /** The level's starting ice (generator-canonical ids), for Restart's re-roll. */
  initialIce: IceGrid;
  /** Concealment snapshots before each pour, mirroring `history` for undo. */
  hiddenHistory: HiddenGrid[];
  /** Currently selected source bottle, or null. */
  selected: number | null;
  /**
   * Bumped whenever a whole new board is installed (level load or restart) — never on a pour or
   * undo. The UI folds it into the bottles' React keys so a fresh board remounts rather than
   * diffing into the old one, which keeps the liquid fill animation to actual pours: a remounted
   * `AnimatePresence` treats its segments as already-present (initial), so they appear instantly
   * instead of animating in (and the outgoing board's segments don't animate out).
   */
  boardNonce: number;
  status: GameStatus;
  /**
   * True while a live (un-baked) level is being generated. Baked levels load synchronously, so this
   * is only set for the plateau tail / endless levels, whose generation can take up to ~1–2s — the
   * UI shows a spinner meanwhile. The CSS spinner is compositor-animated, so it keeps spinning even
   * though generation blocks the main thread.
   */
  loading: boolean;
  /** The player's global campaign position (1-based). */
  level: number;
  /** Difficulty phase label for the current level (derived from the level number). */
  phase: Difficulty;
  /** Board mechanics active this level (empty in chapter 0). */
  mechanics: readonly Mechanic[];
  /** Achievable near-optimal move count for the current level (3★ cutoff) — basis for the star rating. */
  optimal: number;
  /** 2★ ceiling for the current level (adjusted near-optimal band; always `> optimal`). */
  twoStarMax: number;
  /** The player's best (fewest) moves for the current level, or null if never solved. */
  best: number | null;
  /** The player's best star rating for the current level, or null if never solved. */
  bestStars: Stars | null;
  /** Highest level reached (the unlock frontier) — the level selector lists 1..furthest. */
  furthest: number;
  /** Whether every baked campaign level is cleared — the random mode replaces Continue on Home. */
  campaignComplete: boolean;
  /** Best star rating per reached level, for the level selector. */
  levelStars: Record<number, Stars>;
  /** Campaign vs. post-campaign "Random" play. */
  mode: GameMode;
  /** Consecutive random-board wins in the current endless session (0 in campaign mode). */
  endlessStreak: number;
  /** Longest random-board win streak ever (persisted). */
  endlessBestStreak: number;

  /** Load a specific level into play (regenerates its board) and persist it as reached. */
  loadLevel: (level: number) => void;
  /** Advance: next campaign level, the random mode after the last campaign level, or a fresh random board in endless mode. */
  nextLevel: () => void;
  /** Start the post-campaign "Play Random" mode (resets the current streak). */
  playRandom: () => void;
  /** Wipe saved progress and return to level 1. */
  startOver: () => void;
  /**
   * Admin/testing hatch: raise the unlock frontier so every level up to `level` (clamped to the
   * baked campaign) becomes playable. Never lowers progress, never touches earned stars/best scores.
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
function noPlayerMove(state: GameState, blocked: HiddenGrid, funnels: FunnelGrid): boolean {
  const n = state.bottles.length;
  for (let from = 0; from < n; from++) {
    const src = state.bottles[from]!;
    if (src.length === 0 || isCapped(src, state.capacity, blocked[from])) continue;
    // A tube whose visible top run is frozen has nothing pourable — not an escape move.
    if (knownTopRun(src, blocked[from]) === 0) continue;
    const color = topColor(src)!;
    for (let to = 0; to < n; to++) {
      // A funnel-blocked pour isn't an escape move — exclude it just as the player can't make it.
      if (from !== to && canPour(state, from, to) && funnelAccepts(funnels, to, color)) return false;
    }
  }
  return true;
}

/**
 * Status for a board: a win, a hard wall (no legal move), a `stuck` loop (moves remain but every
 * reachable board has already been seen — `visited`), or normal play. A board only counts as won
 * once every bottle is sorted AND no concealed cell remains — a tube that still holds a "?" isn't
 * finished, even if its real colors already match. The loop check runs full-information, which is a
 * superset of the player's (cap/conceal-limited) moves, so it can only ever *under*-fire — a player
 * who still has a real move available is never told they're stuck.
 */
function syncStatus(
  state: GameState,
  hidden: HiddenGrid,
  funnels: FunnelGrid,
  ice: IceGrid,
  visited: ReadonlySet<string>,
): GameStatus {
  // Frozen cells block pours and capping exactly like a hidden "?", so fold them into the columns the
  // run-cap/cap helpers consult (a no-op when the board carries no ice).
  const blocked = blockedColumns(state, hidden, ice);
  // A board is won only once every bottle is sorted AND nothing is concealed AND nothing is frozen —
  // a tube still holding ice or a "?" isn't finished even if its real colors match.
  if (isWon(state)) return anyHidden(hidden) || anyFrozen(state, hidden, ice) ? 'playing' : 'won';
  if (noPlayerMove(state, blocked, funnels)) return 'deadlocked';
  if (isStuckInLoop(state, visited, { funnels })) return 'stuck';
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
    const funnels = extra.funnels ?? get().funnels;
    const ice = extra.ice ?? get().ice;
    const visited = extra.visited ?? get().visited;
    const status = syncStatus(current, hidden, funnels, ice, visited);
    set({ current, status, ...extra });

    if (status !== 'won') return;

    if (get().mode === 'endless') {
      // Endless: count the win toward the streak and keep the longest seen (no per-level records).
      const streak = get().endlessStreak + 1;
      set({ endlessStreak: streak, endlessBestStreak: campaign.recordRandomHard(streak) });
    } else {
      const { level, moves, undos, optimal, twoStarMax } = get();
      // Undos count toward the rating: the score is the real move count plus undos used.
      const score = moves.length + undos;
      const record = campaign.complete(level, score, starsFor(score, optimal, twoStarMax));
      // Completing the last baked level flips `campaignComplete`, unlocking the random mode on Home.
      set({ ...record, levelStars: campaign.levelStars, campaignComplete: campaign.campaignComplete });
    }
  };

  /**
   * The reset fields shared by every "install a freshly generated board" path (`applyLevel`,
   * `applyRandom`): clear the in-progress attempt (history / moves / undos / selection, and re-seed
   * `visited`), install the recolored `board`/`funnels` alongside the canonical `initial`/`initial*`
   * (kept generator-canonical so Restart re-rolls the hues), carry the board's level metadata, clear
   * `loading`, and bump the remount nonce. The mode-specific fields (campaign records vs. the endless
   * reset) are spread on top by each caller.
   */
  const freshBoardState = (
    generated: PlayableLevel,
    board: GameState,
    funnels: FunnelGrid,
    ice: IceGrid,
  ): Partial<GameStore> => ({
    initial: generated.state,
    hidden: generated.hidden,
    initialHidden: generated.hidden,
    funnels,
    initialFunnels: generated.funnels,
    ice,
    initialIce: generated.ice,
    hiddenHistory: [],
    history: [],
    moves: [],
    undos: 0,
    visited: new Set([canonical(board)]),
    selected: null,
    boardNonce: get().boardNonce + 1,
    loading: false,
    phase: generated.phase,
    mechanics: generated.mechanics,
    optimal: generated.optimal,
    twoStarMax: generated.twoStarMax,
  });

  /** Synchronously generate/load `level` and commit it as the active board (clears `loading`). */
  const applyLevel = (level: number) => {
    const generated = getLevel(level);
    // Replaying an earlier level must not lower the unlock frontier.
    campaign.reach(level);
    // Display the board under a fresh random palette; `freshBoardState` keeps `initial`/`initialFunnels`
    // in the generator's canonical colors so each Restart re-rolls the hues (see `restart`).
    const { board, funnels, ice } = recolorBoard(generated.state, generated.funnels, generated.ice);
    commit(board, {
      ...freshBoardState(generated, board, funnels, ice),
      mode: 'campaign',
      level,
      ...campaign.recordFor(level),
      furthest: campaign.furthest,
      campaignComplete: campaign.campaignComplete,
      levelStars: campaign.levelStars,
    });
  };

  /** Generate and commit a fresh random board (endless mode). Mirrors `applyLevel`. */
  const applyRandom = (seed: number) => {
    const generated = generateRandomLevel(seed);
    const { board, funnels, ice } = recolorBoard(generated.state, generated.funnels, generated.ice);
    commit(board, {
      ...freshBoardState(generated, board, funnels, ice),
      mode: 'endless',
      best: null, // random boards have no per-level best/stars
      bestStars: null,
    });
  };

  /** A fresh 32-bit seed for a random board. */
  const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;

  /**
   * Load a level. Baked levels apply instantly; live (un-baked) levels take up to ~1s to generate, so
   * we flip on `loading` (with the new level's header info) and defer the blocking generation until
   * after the spinner has painted (see `deferAfterPaint`).
   */
  const loadLevel = (level: number) => {
    if (hasBakedLevel(level)) {
      applyLevel(level);
      return;
    }
    set({
      loading: true,
      selected: null,
      mode: 'campaign',
      level,
      phase: phaseForLevel(level),
      mechanics: mechanicsForLevel(level),
    });
    deferAfterPaint(() => applyLevel(level));
  };

  /**
   * Enter the post-campaign "Play Random" mode: reset the session streak and generate a fresh random
   * board behind the spinner (always live, so always deferred — same pattern as a tail `loadLevel`).
   * `phase` is a provisional label for the spinner header; `applyRandom` sets the board's real phase.
   */
  const playRandom = () => {
    const seed = randomSeed();
    set({
      loading: true,
      selected: null,
      mode: 'endless',
      endlessStreak: 0,
      phase: 'hard',
      mechanics: mechanicsForLevel(MAX_UNLOCK_LEVEL),
    });
    deferAfterPaint(() => applyRandom(seed));
  };

  // Initial level: resume where the player left off. The displayed board gets fresh random hues;
  // `initial` stays canonical so Restart re-rolls them. A baked start loads instantly; a tail start
  // shows the spinner and generates on the next macrotask (mirrors `loadLevel`).
  const startLevel = campaign.furthest;
  const startBaked = hasBakedLevel(startLevel);
  const first = startBaked ? getLevel(startLevel) : null;
  const firstRecolored = first ? recolorBoard(first.state, first.funnels, first.ice) : null;
  const firstBoard = firstRecolored?.board ?? { bottles: [], capacity: DEFAULT_CAPACITY };
  const firstHidden = first?.hidden ?? [];
  const firstFunnels: FunnelGrid = firstRecolored?.funnels ?? [];
  const firstInitialFunnels: FunnelGrid = first?.funnels ?? [];
  const firstIce: IceGrid = firstRecolored?.ice ?? [];
  const firstInitialIce: IceGrid = first?.ice ?? [];
  const firstVisited = new Set<string>([canonical(firstBoard)]);
  if (!startBaked) deferAfterPaint(() => applyLevel(startLevel));

  return {
    current: firstBoard,
    initial: first?.state ?? firstBoard,
    hidden: firstHidden,
    initialHidden: firstHidden,
    funnels: firstFunnels,
    initialFunnels: firstInitialFunnels,
    ice: firstIce,
    initialIce: firstInitialIce,
    hiddenHistory: [],
    history: [],
    moves: [],
    undos: 0,
    visited: firstVisited,
    selected: null,
    boardNonce: 0,
    status: first ? syncStatus(firstBoard, firstHidden, firstFunnels, firstIce, firstVisited) : 'playing',
    loading: !startBaked,
    level: startLevel,
    phase: first?.phase ?? phaseForLevel(startLevel),
    mechanics: first?.mechanics ?? mechanicsForLevel(startLevel),
    optimal: first?.optimal ?? 0,
    twoStarMax: first?.twoStarMax ?? 2,
    ...campaign.recordFor(startLevel),
    furthest: campaign.furthest,
    campaignComplete: campaign.campaignComplete,
    levelStars: campaign.levelStars,
    mode: 'campaign',
    endlessStreak: 0,
    endlessBestStreak: campaign.randomHardBestStreak,

    loadLevel,
    nextLevel: () => {
      if (get().mode === 'endless') {
        // Keep the streak going; just re-roll a new random board.
        const seed = randomSeed();
        set({ loading: true, selected: null });
        deferAfterPaint(() => applyRandom(seed));
        return;
      }
      // Past the last baked level the campaign doesn't continue — flow into the random mode.
      if (get().level >= BAKED_LEVEL_COUNT) {
        playRandom();
        return;
      }
      loadLevel(get().level + 1);
    },
    playRandom,
    startOver: () => {
      campaign.reset();
      loadLevel(1);
    },

    unlockUpTo: (level) => {
      campaign.unlockTo(level, MAX_UNLOCK_LEVEL);
      // Unlocking to the last level also opens "Play Random" — mirror both so Home reacts.
      set({ furthest: campaign.furthest, campaignComplete: campaign.campaignComplete });
    },

    tapBottle: (i) => {
      const { current, selected, status, hidden, funnels, ice } = get();
      if (status !== 'playing') return;

      // Frozen cells block the run and capping like a hidden "?", so consult the merged columns.
      const blocked = blockedColumns(current, hidden, ice);

      // A capped (finished) tube is inert. A tube whose visible top run is entirely frozen has nothing
      // pourable, so it can't be a source either — both are unselectable.
      const selectable = (b: number) =>
        current.bottles[b] !== undefined &&
        current.bottles[b].length > 0 &&
        !isCapped(current.bottles[b], current.capacity, blocked[b]) &&
        knownTopRun(current.bottles[b], blocked[b]) > 0;

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
      // visible run, so cap the pour at what the player can actually see. A funnel tube rejects any
      // color but its tint, so a mismatched pour falls through to reselection below.
      if (
        canPour(current, selected, i) &&
        funnelAccepts(funnels, i, topColor(current.bottles[selected]!)!)
      ) {
        // Cap the pour at the visible, non-frozen top run — what the player can actually move.
        const cap = knownTopRun(current.bottles[selected]!, blocked[selected]);
        const { state: next, move } = pour(current, selected, i, cap);
        const revealed = revealExposed(next, hidden);
        const visited = new Set(get().visited).add(canonical(next));
        commit(next, {
          history: [...get().history, current],
          hiddenHistory: [...get().hiddenHistory, hidden],
          hidden: revealed,
          moves: [...get().moves, move],
          visited,
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
      // Undo rewinds the board but NOT the rating: `undos` keeps climbing (it counts toward the
      // star score), and `visited` stays monotonic so re-treading the same branch still reads as
      // circling. `visited` already holds `previous`, so the rewound board is never falsely `stuck`.
      commit(previous, {
        history: history.slice(0, -1),
        hiddenHistory: hiddenHistory.slice(0, -1),
        hidden: hiddenHistory[hiddenHistory.length - 1]!,
        moves: moves.slice(0, -1),
        undos: get().undos + 1,
        selected: null,
      });
    },

    restart: () => {
      // Re-roll BOTH the palette and the tube order on every restart: the same puzzle, but with
      // new colors and a new left-to-right arrangement, so a solved level can't be replayed from
      // muscle memory. `initial`/`initialHidden` stay canonical, so each restart re-rolls afresh.
      const shuffled = shuffleBottles(
        get().initial,
        get().initialHidden,
        get().initialFunnels,
        get().initialIce,
      );
      const { board, funnels, ice } = recolorBoard(shuffled.state, shuffled.funnels, shuffled.ice);
      commit(board, {
        history: [],
        hiddenHistory: [],
        hidden: shuffled.hidden,
        funnels,
        ice,
        moves: [],
        undos: 0,
        visited: new Set([canonical(board)]),
        selected: null,
        boardNonce: get().boardNonce + 1,
      });
    },
  };
});
