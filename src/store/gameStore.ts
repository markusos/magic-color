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
import {
  initCoreWasm,
  wasmForcePour,
  wasmHintMove,
  wasmStuck,
  type HintMove,
} from '../game/coreWasm';
import { DEFAULT_CAPACITY } from '../game/palette';
import {
  BAKED_LEVEL_COUNT,
  generateDailyLevel,
  generateRandomLevel,
  getLevel,
  hasBakedLevel,
  type LoadedLevel,
  resetLiveGenerator,
} from '../game/levelLoader';
import type { LiveProvenance } from '../game/provenance';
import { type DailyRecord, todayKey } from '../game/daily';
import { mechanicsForLevel, phaseForLevel } from '../game/progression';
import { type HiddenGrid } from '../game/hidden';
import { type FunnelGrid } from '../game/funnels';
import { type IceGrid } from '../game/ice';
import { type OverlaySet } from '../game/mechanics';
import { recolorBoard } from '../game/recolor';
import { shuffleBottles } from '../game/shuffle';
import { starsFor, type Stars } from '../game/stars';
import { cueForTap, deriveStatus, type GameStatus, planTap } from './session';
import type { Difficulty, GameState, Mechanic, Move } from '../game/types';
import { createCampaign } from './campaign';
import { useSettings } from './settings';
import type { CampaignStats } from './progressStats';
import { deferAfterPaint } from './deferAfterPaint';
import { feedback } from '../audio/feedback';

export type { GameStatus };

/** Campaign play (the numbered track), the post-campaign "Random" challenge, or the daily challenge. */
export type GameMode = 'campaign' | 'endless' | 'daily';

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
  // (The per-attempt visited set lives CORE-SIDE since F5 — see `wasmStuck` — kept
  // monotonically across undo and reset only on a fresh board / restart.)
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
   * True while the hint A* is running AND has taken longer than the spinner threshold — drives a
   * small spinner on the Hint button (NOT the full-screen level-load spinner). The compute runs in a
   * worker, so this only flips on once a `setTimeout` has had a chance to fire (a fast hint never
   * shows a spinner). Cleared the instant the worker answers.
   */
  hintLoading: boolean;
  /**
   * True when the last hint request found nothing to suggest (genuinely stuck, or the node budget was
   * exhausted) — drives a transient "No hint available" popover that auto-dismisses after 2s.
   */
  hintUnavailable: boolean;
  /**
   * True while an auto-solve run is in progress (admin/E4) — drives a "solving…" spinner on the game
   * screen. The per-move solve runs off-thread in the hint worker (so it never freezes the page), and
   * the run is cancelled by any manual interaction, a board change, or the Stop control.
   */
  autoSolving: boolean;
  /**
   * Transient message shown (then auto-faded) when an auto-solve run stops WITHOUT winning — the solver
   * timed out or found no continuation. Null while idle or during a successful run. See {@link autoSolve}.
   */
  autoSolveNotice: string | null;
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
  /**
   * For a LIVE board (random/endless, daily, un-baked tail) the difficulty metrics the generator
   * measured while choosing it; null for baked boards (their committed provenance is looked up
   * separately, on demand). Powers the inspector's metrics readout on generated boards. See
   * {@link LiveProvenance}.
   */
  liveProvenance: LiveProvenance | null;
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
  /** The UTC date key of the active daily board (`YYYY-MM-DD`), or null when not in daily mode. */
  dailyKey: string | null;
  /** Today's stored daily result (best stars/moves), or null if today's daily isn't solved yet. */
  dailyResult: DailyRecord | null;
  /** Current daily-challenge streak (consecutive solved days ending today). */
  dailyStreak: number;

  /** Load a specific level into play (regenerates its board) and persist it as reached. */
  loadLevel: (level: number) => void;
  /** Advance: next campaign level, the random mode after the last campaign level, or a fresh random board in endless mode. */
  nextLevel: () => void;
  /** Start the post-campaign "Play Random" mode (resets the current streak). */
  playRandom: () => void;
  /** Admin/testing: enter "Play Random" at a SPECIFIC seed, to reproduce a reported random board. */
  loadRandom: (seed: number) => void;
  /** Start today's daily challenge (the date-seeded showcase board). */
  playDaily: () => void;
  /** Admin/testing: re-generate the current board (re-rolls in endless; deterministic reload otherwise). */
  reloadBoard: () => void;
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
  /** Dismiss the transient "No hint available" popover early (the UI also auto-fades it after 2s). */
  dismissHintUnavailable: () => void;
  /**
   * Admin/testing (E4): play the board to completion, applying the optimal next move every
   * {@link AUTO_SOLVE_DELAY_MS} so the solution is visible move by move. Each move is solved off-thread
   * in the hint worker (with a per-move timeout) so a slow board never freezes the page. The win is
   * recorded normally — NOT counted as a hint (no 1★ cap). A no-op unless the board is in play.
   */
  autoSolve: () => void;
  /** Stop an in-progress auto-solve run (the "solving…" spinner's Stop control). */
  cancelAutoSolve: () => void;
}

/**
 * Node budget for the on-demand hint A*. The search runs in a worker (see `getHintWorker`), so a long
 * solve no longer janks the tap handler — the cap only bounds how long the spinner can spin. Set high
 * enough that a hard-but-solvable board (e.g. a 15-tube, heavily-iced level whose ~50-move optimum
 * needs ~500k nodes to surface even a first move) yields a real hint instead of a false "no hint";
 * still bounded so a genuinely deadlocked board returns "no hint" in a few seconds rather than hanging.
 */
const HINT_NODE_BUDGET = 1_000_000;

/** Wait this long before showing the hint spinner — a fast solve resolves first and never flashes it. */
const HINT_SPINNER_DELAY_MS = 500;

/**
 * Per-step A* budget for `autoSolve` (admin-only). Much larger than the hint's — it runs off-thread and
 * is wall-clock-bounded below, and the hardest hidden 15-tube boards need well over a million nodes to
 * surface even a first move. A move that still overflows this stops the run (with the "no move" notice).
 */
const AUTO_SOLVE_NODE_BUDGET = 20_000_000;

/** Delay between auto-solve moves so the solution plays out visibly, move by move. */
const AUTO_SOLVE_DELAY_MS = 500;
/**
 * Wall-clock backstop per move: if the off-thread solve hasn't answered in time, stop the run and show a
 * "timed out" notice. Generous — it runs off-thread with a Stop button, and the hardest concealed boards
 * legitimately need this long to search {@link AUTO_SOLVE_NODE_BUDGET} nodes for a first move.
 */
const AUTO_SOLVE_MOVE_TIMEOUT_MS = 60_000;
/** How long the auto-solve stop notice ("timed out" / "no further moves") stays up before fading. */
const AUTO_SOLVE_NOTICE_MS = 5_000;

/**
 * Lazily-created, reused worker that runs the hint A* off the main thread (`coreHintWorker` —
 * the Rust core; the JS twin was deleted at F5). Created on first hint so boot stays light,
 * and kept alive for subsequent hints. Returns null when the platform has no `Worker`
 * (jsdom/tests) or construction throws, so the store falls back to a synchronous main-thread
 * wasm solve.
 */
let hintWorker: Worker | null = null;
const getHintWorker = (): Worker | null => {
  if (hintWorker) return hintWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    hintWorker = new Worker(new URL('../game/coreHintWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    hintWorker = null;
  }
  return hintWorker;
};

// Initialize the main-thread wasm instance at boot: the stuck-loop check and the no-worker
// hint fallback call it synchronously, so it must be instantiated ahead of need. `typeof
// Worker` is the real-browser sentinel — jsdom/tests have no Worker and no wasm fetch either;
// they init explicitly via `initCoreWasmSync` (see src/test/setup.ts).
if (typeof Worker !== 'undefined') void initCoreWasm();

export const useGameStore = create<GameStore>((set, get) => {
  // The persisted campaign — the sole owner of progress + localStorage.
  const campaign = createCampaign();

  // True while a hint solve is in flight — guards against a double-tap kicking off a second worker
  // round-trip (and a duplicate `recordHint`) before the first answers.
  let hintPending = false;

  // Auto-solve run state. `autoSolveGen` is bumped on every start/stop; in-flight worker callbacks and
  // the between-move timer capture the generation they belong to and no-op if it has moved on (so a
  // stale solve from a cancelled run can never apply a move to the current board).
  let autoSolveGen = 0;
  let autoSolveTimer: ReturnType<typeof setTimeout> | null = null;
  let autoSolveNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  const stopAutoSolve = () => {
    autoSolveGen++;
    if (autoSolveTimer !== null) {
      clearTimeout(autoSolveTimer);
      autoSolveTimer = null;
    }
    if (get().autoSolving) set({ autoSolving: false });
  };
  /** Flash a transient auto-solve stop message, auto-clearing it after {@link AUTO_SOLVE_NOTICE_MS}. */
  const showAutoSolveNotice = (message: string) => {
    if (autoSolveNoticeTimer !== null) clearTimeout(autoSolveNoticeTimer);
    set({ autoSolveNotice: message });
    autoSolveNoticeTimer = setTimeout(() => {
      autoSolveNoticeTimer = null;
      set({ autoSolveNotice: null });
    }, AUTO_SOLVE_NOTICE_MS);
  };

  /**
   * Commit a new board: set the synchronously-known status. On a win, record the best result for
   * the current level via the campaign and mirror it into the reactive fields.
   */
  const commit = (current: GameState, extra: Partial<GameStore>) => {
    const hidden = extra.hidden ?? get().hidden;
    const funnels = extra.funnels ?? get().funnels;
    const ice = extra.ice ?? get().ice;
    // Record every committed board into the core's visited registry (inserts are idempotent,
    // so undo targets are fine), then derive status — F6: one core call; the stuck check
    // consults the same registry internally.
    wasmStuck.visit(current);
    const status = deriveStatus(current, { hidden, funnels, ice });
    set({ current, status, ...extra });

    if (status !== 'won') return;

    if (get().mode === 'endless') {
      // Endless: count the win toward the streak and keep the longest seen (no per-level records).
      const streak = get().endlessStreak + 1;
      set({ endlessStreak: streak, endlessBestStreak: campaign.recordRandomHard(streak) });
      return;
    }

    if (get().mode === 'daily') {
      // Daily: record today's result (best kept) and refresh the streak. No per-level/campaign record.
      const { dailyKey, moves, undos, optimal, twoStarMax, hintUsed } = get();
      if (dailyKey) {
        const score = moves.length + undos;
        const stars = hintUsed ? 1 : starsFor(score, optimal, twoStarMax);
        const record = campaign.recordDaily(dailyKey, stars, score);
        set({ dailyResult: record, dailyStreak: campaign.dailyStreak(todayKey()) });
      }
      return;
    }

    const { level, moves, undos, optimal, twoStarMax, hintUsed } = get();
    // Undos count toward the rating: the score is the real move count plus undos used.
    const score = moves.length + undos;
    // A hinted solve is capped to 1 star regardless of move count (see `hintUsed`).
    const stars = hintUsed ? 1 : starsFor(score, optimal, twoStarMax);
    const record = campaign.complete(level, score, stars);
    // Completing the last baked level flips `campaignComplete`, unlocking the random mode on Home.
    set({ ...record, levelStars: campaign.levelStars, campaignComplete: campaign.campaignComplete });
  };

  /**
   * The reset fields shared by every "install a freshly generated board" path (`applyLevel`,
   * `applyRandom`): clear the in-progress attempt (history / moves / undos / selection, and re-seed
   * the core-side visited registry), install the recolored `board`/`funnels` alongside the canonical `initial`/`initial*`
   * (kept generator-canonical so Restart re-rolls the hues), carry the board's level metadata, clear
   * `loading`, and bump the remount nonce. The mode-specific fields (campaign records vs. the endless
   * reset) are spread on top by each caller.
   */
  const freshBoardState = (
    generated: LoadedLevel,
    board: GameState,
    display: OverlaySet,
  ): Partial<GameStore> => {
    wasmStuck.reset(board); // re-seed the core-side visited registry with the new board
    return {
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
      selected: null,
      hint: null,
      hintUsed: false,
      hintLoading: false,
      hintUnavailable: false,
      autoSolving: false,
      autoSolveNotice: null,
      boardNonce: get().boardNonce + 1,
      loading: false,
      phase: generated.phase,
      mechanics: generated.mechanics,
      optimal: generated.optimal,
      twoStarMax: generated.twoStarMax,
      liveProvenance: generated.liveProvenance ?? null,
    };
  };

  /** Synchronously generate/load `level` and commit it as the active board (clears `loading`). */
  const applyLevel = (level: number) => {
    stopAutoSolve(); // a board change ends any auto-solve run
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
    stopAutoSolve();
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

  /** Generate and commit the date-seeded daily board. Mirrors `applyRandom` (no per-level records). */
  const applyDaily = (key: string) => {
    stopAutoSolve();
    const generated = generateDailyLevel(key);
    const { board, overlays } = recolorBoard(generated.state, {
      hidden: generated.hidden,
      funnels: generated.funnels,
      ice: generated.ice,
    });
    commit(board, {
      ...freshBoardState(generated, board, overlays),
      mode: 'daily',
      dailyKey: key,
      best: null, // the daily has no per-level best/stars
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
   * Enter the post-campaign "Play Random" mode at a SPECIFIC seed: reset the session streak and generate
   * that exact random board behind the spinner (always live, so always deferred — same pattern as a tail
   * `loadLevel`). `phase` is a provisional spinner-header label; `applyRandom` sets the board's real phase.
   * `playRandom` rolls a fresh seed; the admin hatch uses this directly to reproduce a reported board.
   */
  const loadRandom = (seed: number) => {
    set({
      loading: true,
      selected: null,
      mode: 'endless',
      endlessStreak: 0,
      phase: 'hard',
      mechanics: mechanicsForLevel(MAX_UNLOCK_LEVEL),
    });
    deferAfterPaint(() => applyRandom(seed >>> 0));
  };

  /** Enter "Play Random" with a fresh seed. */
  const playRandom = () => loadRandom(randomSeed());

  /**
   * Re-generate and re-commit the CURRENT board (admin/debug). Drops the memoized live boards first so a
   * tail/daily reload truly regenerates (e.g. to re-time generation or pick up a dev code change);
   * endless re-rolls a fresh random board. Baked campaign levels reload instantly (deterministic, no
   * spinner); live ones go behind the spinner like a normal load.
   */
  const reloadBoard = () => {
    resetLiveGenerator();
    const { mode, level, dailyKey } = get();
    if (mode === 'endless') {
      set({ loading: true, selected: null });
      deferAfterPaint(() => applyRandom(randomSeed()));
      return;
    }
    if (mode === 'daily') {
      const key = dailyKey ?? todayKey();
      set({ loading: true, selected: null });
      deferAfterPaint(() => applyDaily(key));
      return;
    }
    if (hasBakedLevel(level)) {
      applyLevel(level); // deterministic + synchronous — no spinner needed
      return;
    }
    set({ loading: true, selected: null });
    deferAfterPaint(() => applyLevel(level));
  };

  /**
   * Enter today's daily challenge: flip on the spinner (the daily is always live) and generate the
   * date-seeded board on the next macrotask. `phase` is a provisional spinner-header label; `applyDaily`
   * sets the board's real phase. Always for today (UTC) so the board matches every other device.
   */
  const playDaily = () => {
    const key = todayKey();
    set({
      loading: true,
      selected: null,
      mode: 'daily',
      dailyKey: key,
      phase: 'hard',
      mechanics: mechanicsForLevel(MAX_UNLOCK_LEVEL),
    });
    deferAfterPaint(() => applyDaily(key));
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
  wasmStuck.reset(firstBoard); // seed the core-side visited registry with the resume board
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
    selected: null,
    hint: null,
    hintUsed: false,
    hintLoading: false,
    hintUnavailable: false,
    autoSolving: false,
    autoSolveNotice: null,
    boardNonce: 0,
    status: first ? deriveStatus(firstBoard, firstDisplay) : 'playing',
    loading: !startBaked,
    level: startLevel,
    phase: first?.phase ?? phaseForLevel(startLevel),
    mechanics: first?.mechanics ?? mechanicsForLevel(startLevel),
    optimal: first?.optimal ?? 0,
    twoStarMax: first?.twoStarMax ?? 2,
    liveProvenance: first?.liveProvenance ?? null,
    ...campaign.recordFor(startLevel),
    furthest: campaign.furthest,
    campaignComplete: campaign.campaignComplete,
    levelStars: campaign.levelStars,
    mode: 'campaign',
    endlessStreak: 0,
    endlessBestStreak: campaign.randomHardBestStreak,
    dailyKey: null,
    dailyResult: campaign.dailyResult(todayKey()),
    dailyStreak: campaign.dailyStreak(todayKey()),

    loadLevel,
    nextLevel: () => {
      // The daily is a single board per day — there's no "next" (the win overlay offers Share/Home).
      if (get().mode === 'daily') return;
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
    loadRandom,
    playDaily,
    reloadBoard,
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
      stopAutoSolve(); // a manual tap takes over from any auto-solve run
      const { current, selected, status, hidden, funnels, ice } = get();
      if (status !== 'playing') return;

      // Free-pour cheat (E4): bypass the session rules entirely — select any non-empty tube, then force
      // its top run onto any tube with room (ignoring colour / funnel / ice). Still records history,
      // visited, reveals exposed "?"s, and derives the resulting status, so undo and win-detection work.
      if (useSettings.getState().freePour) {
        if (selected === null) {
          if (current.bottles[i]!.length > 0) set({ selected: i, hint: null });
          return;
        }
        if (selected === i) {
          set({ selected: null, hint: null });
          return;
        }
        const fp = wasmForcePour(current, hidden, selected, i);
        if (!fp) {
          set({ selected: current.bottles[i]!.length > 0 ? i : null, hint: null });
          return;
        }
        commit(fp.next, {
          history: [...get().history, current],
          hiddenHistory: [...get().hiddenHistory, hidden],
          hidden: fp.revealedHidden,
          moves: [...get().moves, fp.move],
          selected: null,
          hint: null,
        });
        feedback('pour', fp.next.bottles[i]!.length / fp.next.capacity);
        return;
      }

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
          commit(plan.next, {
            history: [...get().history, current],
            hiddenHistory: [...get().hiddenHistory, hidden],
            hidden: plan.revealedHidden,
            moves: [...get().moves, plan.move],
            selected: null,
            hint: null,
          });
          break;
        }
      }

      // Fire the matching audio/haptic cue off the (now-applied) outcome — a thin adapter over the
      // pure session classification, read against the post-tap status (a pour may have won the board).
      // For a pour, pass the destination's resulting fill so the blip rises as a tube fills up.
      const cue = cueForTap(plan, get().status, selected, i);
      if (cue) {
        const level =
          plan.kind === 'pour'
            ? plan.next.bottles[plan.move.to]!.length / plan.next.capacity
            : undefined;
        feedback(cue, level);
      }
    },

    undo: () => {
      stopAutoSolve();
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
      stopAutoSolve();
      // Re-roll BOTH the palette and the tube order on every restart: the same puzzle, but with
      // new colors and a new left-to-right arrangement, so a solved level can't be replayed from
      // muscle memory. `initial`/`initialHidden` stay canonical, so each restart re-rolls afresh.
      const shuffled = shuffleBottles(get().initial, {
        hidden: get().initialHidden,
        funnels: get().initialFunnels,
        ice: get().initialIce,
      });
      const { board, overlays } = recolorBoard(shuffled.state, shuffled.overlays);
      wasmStuck.reset(board); // restart = a fresh attempt: re-seed the visited registry
      commit(board, {
        history: [],
        hiddenHistory: [],
        hidden: overlays.hidden,
        funnels: overlays.funnels,
        ice: overlays.ice,
        moves: [],
        undos: 0,
        selected: null,
        hint: null,
        hintUsed: false,
        hintLoading: false,
        hintUnavailable: false,
        boardNonce: get().boardNonce + 1,
      });
    },

    requestHint: () => {
      stopAutoSolve(); // don't let a hint and an auto-solve run fight over the shared worker
      const { current, hidden, funnels, ice, status } = get();
      // Ignore re-taps while a hint is already in flight, and only hint a live board.
      if (status !== 'playing' || hintPending) return;
      hintPending = true;
      // Clear any lingering "no hint" popover from a previous press.
      set({ hintUnavailable: false });

      const overlays = { funnels, ice };

      // Show the spinner only if the solve is slow (>500 ms). The timer can fire because the heavy
      // work runs off-thread in the worker; a fast hint resolves first and cancels it, so the button
      // never flickers a spinner for the common instant case.
      let spinnerTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        spinnerTimer = null;
        set({ hintLoading: true });
      }, HINT_SPINNER_DELAY_MS);

      // Settle one request: stop the spinner timer, then either pulse the move or pop the
      // "no hint" notice. Optimal *from the current board* (after any undos / partial solve) under the
      // live overlays — not necessarily the baked solution's next move.
      const finish = (move: HintMove | null) => {
        hintPending = false;
        if (spinnerTimer) {
          clearTimeout(spinnerTimer);
          spinnerTimer = null;
        }
        if (move) {
          // Taking a hint caps this attempt's rating to 1 star (see `hintUsed`) and adds to the
          // persisted lifetime hint tally surfaced on the stats screen.
          campaign.recordHint();
          set({ hint: move, selected: null, hintUsed: true, hintLoading: false });
          feedback('select');
        } else {
          // Won is filtered out above; stuck/budget-exhausted → no continuation to offer. Flag the
          // transient popover (the UI fades it out after 2s) and nudge toward Undo/Restart.
          set({ hintLoading: false, hintUnavailable: true });
          feedback('invalid');
        }
      };

      const worker = getHintWorker();
      if (worker) {
        worker.onmessage = (e: MessageEvent<HintMove | null>) => finish(e.data);
        worker.onerror = () => {
          // Worker failed to load/run — fall back to a synchronous main-thread wasm solve.
          finish(wasmHintMove(current, hidden, overlays, HINT_NODE_BUDGET));
        };
        worker.postMessage({ state: current, hidden, overlays, maxNodes: HINT_NODE_BUDGET });
      } else {
        // No worker (e.g. jsdom/tests): solve inline through the main-thread wasm. The spinner
        // timer is cancelled by `finish` before it can fire, so this stays synchronous.
        finish(wasmHintMove(current, hidden, overlays, HINT_NODE_BUDGET));
      }
    },

    dismissHintUnavailable: () => {
      if (get().hintUnavailable) set({ hintUnavailable: false });
    },

    autoSolve: () => {
      stopAutoSolve(); // cancel any prior run and take a fresh generation
      if (get().status !== 'playing') return;
      const gen = autoSolveGen;
      const nonce = get().boardNonce;
      const startedAt = performance.now();
      let applied = 0; // moves applied so far this run (for the summary / logs)
      set({ autoSolving: true, autoSolveNotice: null, selected: null, hint: null });
      console.info(`[auto-solve] start — ${get().mode} L${get().level}`);

      // Whether this run is still the active one AND the same board is in play.
      const live = () => gen === autoSolveGen && get().boardNonce === nonce && get().status === 'playing';
      const finishRun = () => {
        if (gen !== autoSolveGen) return; // a newer run/stop already owns the state
        if (autoSolveTimer !== null) {
          clearTimeout(autoSolveTimer);
          autoSolveTimer = null;
        }
        set({ autoSolving: false });
      };
      // Stop the run early (timed out / no move) with a transient on-screen notice.
      const stop = (message: string) => {
        finishRun();
        showAutoSolveNotice(message);
        feedback('invalid');
        console.warn(`[auto-solve] stopped after ${applied} move(s): ${message}`);
      };

      // Apply one solved move (planTap keeps it legal under the overlays), then schedule the next.
      const apply = (from: number, to: number) => {
        const { current, hidden, ice } = get();
        const plan = planTap(current, { hidden, funnels: get().funnels, ice }, from, to);
        if (plan.kind !== 'pour') {
          stop('No further moves');
          return;
        }
        commit(plan.next, {
          history: [...get().history, current],
          hiddenHistory: [...get().hiddenHistory, hidden],
          hidden: plan.revealedHidden,
          moves: [...get().moves, plan.move],
          selected: null,
          hint: null,
        });
        applied++;
        // Play the move's natural cue — including the win chime on the final move.
        const cue = cueForTap(plan, get().status, from, to);
        if (cue) feedback(cue, plan.next.bottles[plan.move.to]!.length / plan.next.capacity);
        if (get().status === 'won') {
          finishRun();
          console.info(`[auto-solve] solved in ${applied} moves (${Math.round(performance.now() - startedAt)}ms)`);
        } else if (get().status === 'playing') {
          autoSolveTimer = setTimeout(step, AUTO_SOLVE_DELAY_MS);
        } else {
          stop(`Board ${get().status}`); // stuck/deadlocked — shouldn't happen on an optimal line
        }
      };

      // Solve the next move OFF-THREAD (like a hint) so a slow board never janks the page; a wall-clock
      // timeout backstops a hung solve. Falls back to a synchronous solve when there's no worker (tests).
      const step = () => {
        autoSolveTimer = null;
        if (!live()) {
          finishRun();
          return;
        }
        const { current, hidden, funnels, ice } = get();
        const overlays = { funnels, ice };
        const t0 = performance.now();
        let settled = false;
        const done = (move: HintMove | null, timedOut = false) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (!live()) {
            finishRun();
            return;
          }
          if (!move) {
            stop(timedOut ? 'Solver timed out' : 'No further moves');
            return;
          }
          // Per-move timing at debug level, so the default console stays minimal (start/end only).
          console.debug(`[auto-solve] #${applied + 1} ${move.from}→${move.to} (${Math.round(performance.now() - t0)}ms)`);
          apply(move.from, move.to);
        };
        const timeout = setTimeout(() => done(null, true), AUTO_SOLVE_MOVE_TIMEOUT_MS);

        const worker = getHintWorker();
        if (worker) {
          worker.onmessage = (e: MessageEvent<HintMove | null>) => done(e.data);
          worker.onerror = () => done(wasmHintMove(current, hidden, overlays, AUTO_SOLVE_NODE_BUDGET));
          worker.postMessage({ state: current, hidden, overlays, maxNodes: AUTO_SOLVE_NODE_BUDGET });
        } else {
          done(wasmHintMove(current, hidden, overlays, AUTO_SOLVE_NODE_BUDGET));
        }
      };

      step(); // first move computed immediately; the rest follow every AUTO_SOLVE_DELAY_MS
    },

    cancelAutoSolve: stopAutoSolve,
  };
});
