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
import { canonical } from '../game/solver';
import { DEFAULT_CAPACITY } from '../game/generator';
import { BAKED_LEVEL_COUNT, generateRandomLevel, getLevel, hasBakedLevel } from '../game/levelLoader';
import { mechanicsForLevel, phaseForLevel, type PlayableLevel } from '../game/progression';
import { type HiddenGrid } from '../game/hidden';
import { type FunnelGrid } from '../game/funnels';
import { type IceGrid } from '../game/ice';
import { type OverlaySet } from '../game/mechanics';
import { recolorBoard } from '../game/recolor';
import { shuffleBottles } from '../game/shuffle';
import { starsFor, type Stars } from '../game/stars';
import { hintMove, type HintMove } from '../game/search';
import { cueForTap, deriveStatus, type GameStatus, planTap } from './session';
import type { Difficulty, GameState, Mechanic, Move } from '../game/types';
import { createCampaign } from './campaign';
import type { CampaignStats } from './progressStats';
import { deferAfterPaint } from './deferAfterPaint';
import { feedback } from '../audio/feedback';

export type { GameStatus };

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
   * The currently-pulsing hint pour (`{ from, to }` tube indices), or null. Set by `requestHint` and
   * cleared on the next tap / undo / restart / new board, so the pulse never lingers onto a stale
   * board. Display-order indices, parallel to `current.bottles`.
   */
  hint: HintMove | null;
  /**
   * Whether a hint was taken this attempt — a hinted solve is capped to 1 star (no 3★ for a board you
   * were shown the line on). Sticks across undos (so undoing the hinted move can't launder the
   * penalty) and only resets on a fresh board / restart.
   */
  hintUsed: boolean;
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
  /** Read-only aggregate of all saved progress, for the stats screen. Computed on demand. */
  campaignStats: () => CampaignStats;
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
  /**
   * Surface one optimal next pour for the current board and pulse those two tubes. Computed lazily on
   * demand (no solver kept running). A no-op when the board isn't in play; on a won/stuck board there's
   * no move to show, so it just fires the muted "invalid" cue.
   */
  requestHint: () => void;
}

/**
 * Node budget for the on-demand hint A*. Generous — a hint is a one-shot user action, so a brief
 * pause beats giving up — but bounded so a pathological board can't hang the tap handler.
 */
const HINT_NODE_BUDGET = 100_000;

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
    const status = deriveStatus(current, { hidden, funnels, ice }, visited);
    set({ current, status, ...extra });

    if (status !== 'won') return;

    if (get().mode === 'endless') {
      // Endless: count the win toward the streak and keep the longest seen (no per-level records).
      const streak = get().endlessStreak + 1;
      set({ endlessStreak: streak, endlessBestStreak: campaign.recordRandomHard(streak) });
    } else {
      const { level, moves, undos, optimal, twoStarMax, hintUsed } = get();
      // Undos count toward the rating: the score is the real move count plus undos used.
      const score = moves.length + undos;
      // A hinted solve is capped to 1 star regardless of move count (see `hintUsed`).
      const stars = hintUsed ? 1 : starsFor(score, optimal, twoStarMax);
      const record = campaign.complete(level, score, stars);
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
    display: OverlaySet,
  ): Partial<GameStore> => ({
    initial: generated.state,
    hidden: display.hidden,
    initialHidden: generated.hidden,
    funnels: display.funnels,
    initialFunnels: generated.funnels,
    ice: display.ice,
    initialIce: generated.ice,
    hiddenHistory: [],
    history: [],
    moves: [],
    undos: 0,
    visited: new Set([canonical(board)]),
    selected: null,
    hint: null,
    hintUsed: false,
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
    const { board, overlays } = recolorBoard(generated.state, {
      hidden: generated.hidden,
      funnels: generated.funnels,
      ice: generated.ice,
    });
    commit(board, {
      ...freshBoardState(generated, board, overlays),
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
    const { board, overlays } = recolorBoard(generated.state, {
      hidden: generated.hidden,
      funnels: generated.funnels,
      ice: generated.ice,
    });
    commit(board, {
      ...freshBoardState(generated, board, overlays),
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
  const firstRecolored = first
    ? recolorBoard(first.state, { hidden: first.hidden, funnels: first.funnels, ice: first.ice })
    : null;
  const firstBoard = firstRecolored?.board ?? { bottles: [], capacity: DEFAULT_CAPACITY };
  const firstDisplay: OverlaySet = firstRecolored?.overlays ?? { hidden: [], funnels: [], ice: [] };
  const firstInitialFunnels: FunnelGrid = first?.funnels ?? [];
  const firstInitialIce: IceGrid = first?.ice ?? [];
  const firstVisited = new Set<string>([canonical(firstBoard)]);
  if (!startBaked) deferAfterPaint(() => applyLevel(startLevel));

  return {
    current: firstBoard,
    initial: first?.state ?? firstBoard,
    hidden: firstDisplay.hidden,
    initialHidden: first?.hidden ?? [],
    funnels: firstDisplay.funnels,
    initialFunnels: firstInitialFunnels,
    ice: firstDisplay.ice,
    initialIce: firstInitialIce,
    hiddenHistory: [],
    history: [],
    moves: [],
    undos: 0,
    visited: firstVisited,
    selected: null,
    hint: null,
    hintUsed: false,
    boardNonce: 0,
    status: first ? deriveStatus(firstBoard, firstDisplay, firstVisited) : 'playing',
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
    campaignStats: () => campaign.stats(),

    unlockUpTo: (level) => {
      campaign.unlockTo(level, MAX_UNLOCK_LEVEL);
      // Unlocking to the last level also opens "Play Random" — mirror both so Home reacts.
      set({ furthest: campaign.furthest, campaignComplete: campaign.campaignComplete });
    },

    tapBottle: (i) => {
      const { current, selected, status, hidden, funnels, ice } = get();
      if (status !== 'playing') return;

      // The pure session loop decides what the tap does; the store only applies the outcome. Any tap
      // also dismisses a showing hint (the pulse shouldn't outlive the move it suggested).
      const plan = planTap(current, { hidden, funnels, ice }, selected, i);
      switch (plan.kind) {
        case 'ignore':
          break;
        case 'select':
          set({ selected: plan.selected, hint: null });
          break;
        case 'deselect':
          set({ selected: null, hint: null });
          break;
        case 'pour': {
          const visited = new Set(get().visited).add(canonical(plan.next));
          commit(plan.next, {
            history: [...get().history, current],
            hiddenHistory: [...get().hiddenHistory, hidden],
            hidden: plan.revealedHidden,
            moves: [...get().moves, plan.move],
            visited,
            selected: null,
            hint: null,
          });
          break;
        }
      }

      // Fire the matching audio/haptic cue off the (now-applied) outcome — a thin adapter over the
      // pure session classification, read against the post-tap status (a pour may have won the board).
      // For a pour, pass the destination's resulting fill so the blip rises as a tube fills up.
      const cue = cueForTap(plan, current, hidden, ice, get().status, selected, i);
      if (cue) {
        const level =
          plan.kind === 'pour'
            ? plan.next.bottles[plan.move.to]!.length / plan.next.capacity
            : undefined;
        feedback(cue, level);
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
        hint: null,
      });
    },

    restart: () => {
      // Re-roll BOTH the palette and the tube order on every restart: the same puzzle, but with
      // new colors and a new left-to-right arrangement, so a solved level can't be replayed from
      // muscle memory. `initial`/`initialHidden` stay canonical, so each restart re-rolls afresh.
      const shuffled = shuffleBottles(get().initial, {
        hidden: get().initialHidden,
        funnels: get().initialFunnels,
        ice: get().initialIce,
      });
      const { board, overlays } = recolorBoard(shuffled.state, shuffled.overlays);
      commit(board, {
        history: [],
        hiddenHistory: [],
        hidden: overlays.hidden,
        funnels: overlays.funnels,
        ice: overlays.ice,
        moves: [],
        undos: 0,
        visited: new Set([canonical(board)]),
        selected: null,
        hint: null,
        hintUsed: false,
        boardNonce: get().boardNonce + 1,
      });
    },

    requestHint: () => {
      const { current, hidden, funnels, ice, status } = get();
      if (status !== 'playing') return;
      // Optimal *from the current board* (after any undos / partial solve) under the live overlays —
      // not necessarily the baked solution's next move. Honors exactly what the player can see/pour.
      const move = hintMove(current, hidden, { funnels, ice }, HINT_NODE_BUDGET);
      if (move) {
        // Taking a hint caps this attempt's rating to 1 star (see `hintUsed`) and adds to the
        // persisted lifetime hint tally surfaced on the stats screen.
        campaign.recordHint();
        set({ hint: move, selected: null, hintUsed: true });
        feedback('select');
      } else {
        // Won → nothing to hint; stuck/exhausted → no continuation to offer (use Undo/Restart).
        feedback('invalid');
      }
    },
  };
});
