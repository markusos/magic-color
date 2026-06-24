import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { BAKED_LEVEL_COUNT, getLevel } from '../game/levelLoader';
import { canonical, isSolvable, solve, usefulMoves } from '../game/solver';
import { pour } from '../game/engine';
import { optimalCappedMoves } from '../game/search';
import { board, color } from '../test/board';

const store = () => useGameStore.getState();

// The store loads levels through `getLevel`, so the reference board comes from there too (a baked
// board for level 1, not a fresh generation). Baked levels carry no stored solution, so we solve the
// board independently to get a winning line. The displayed colors are randomized per load (see
// recolor.ts), so board comparisons go through `sameLayout`, which checks equality up to a consistent
// color renaming rather than exact ids.
const LEVEL = 1;
const reference = getLevel(LEVEL);
const referenceSolution = solve(reference.state)!;

/**
 * Live (un-baked) levels generate asynchronously: `loadLevel` flips on `loading` and defers the
 * blocking generation until after the spinner paints (two nested rAFs — see `deferAfterPaint`). Tests
 * that load such a level await this to let that deferred work run, mirroring the same double-rAF so it
 * resolves after the generation has committed. Baked levels load synchronously and need no flush.
 */
const flushLoad = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// Live (un-baked) levels past the campaign: generated on demand, so they carry a stored solution and
// drive the loading spinner. The plateau clamps to the last chapter, whose SIGNATURE mechanic is ice —
// hidden is only seasoned in there (light density), so not every tail board carries it. We therefore
// scan for live levels that actually conceal something rather than assuming a fixed offset does. (Scan
// is cheap: `getLevel` is memoized and most boards still conceal at least one cell.)
function liveLevelsWithHidden(count: number): number[] {
  const found: number[] = [];
  for (let level = BAKED_LEVEL_COUNT + 1; found.length < count && level <= BAKED_LEVEL_COUNT + 400; level++) {
    if (getLevel(level).hidden.some((col) => col.some(Boolean))) found.push(level);
  }
  return found;
}
const liveHidden = liveLevelsWithHidden(2);
if (liveHidden.length < 2) throw new Error('expected at least two live levels that conceal a cell');
const [LIVE_HIDDEN, LIVE_HIDDEN_2] = liveHidden as [number, number];

/** Whether two boards are identical up to a consistent 1:1 color renaming (what recolor does). */
function sameLayout(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) return false;
  const fwd = new Map<string, string>();
  const rev = new Map<string, string>();
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.length !== b[i]!.length) return false;
    for (let j = 0; j < a[i]!.length; j++) {
      const x = a[i]![j]!;
      const y = b[i]![j]!;
      if ((fwd.has(x) && fwd.get(x) !== y) || (rev.has(y) && rev.get(y) !== x)) return false;
      fwd.set(x, y);
      rev.set(y, x);
    }
  }
  return true;
}

beforeEach(() => {
  localStorage.clear();
  store().loadLevel(LEVEL);
});

/** Drive a list of engine moves through the tap interface (select source, tap target). */
function playSolution() {
  for (const move of referenceSolution) {
    store().tapBottle(move.from);
    store().tapBottle(move.to);
  }
}

describe('loadLevel', () => {
  it('starts in the playing state with the level and its optimal reference', () => {
    const s = store();
    expect(s.status).toBe('playing');
    expect(s.level).toBe(LEVEL);
    expect(s.optimal).toBe(reference.optimal);
    // `initial` keeps the canonical colors; the displayed board is a recoloring of the same layout.
    expect(s.initial.bottles).toEqual(reference.state.bottles);
    expect(sameLayout(s.current.bottles, reference.state.bottles)).toBe(true);
    expect(s.history).toHaveLength(0);
    expect(s.selected).toBeNull();
  });
});

describe('progression', () => {
  it('records a best score on win and advances with nextLevel', () => {
    for (const move of referenceSolution) {
      store().tapBottle(move.from);
      store().tapBottle(move.to);
    }
    expect(store().status).toBe('won');
    expect(store().best).toBe(referenceSolution.length);

    store().nextLevel();
    expect(store().level).toBe(LEVEL + 1);
    expect(store().status).toBe('playing');
    expect(store().moves).toHaveLength(0);
  });

  it('startOver wipes progress and returns to level 1', () => {
    store().loadLevel(5);
    expect(store().level).toBe(5);
    store().startOver();
    expect(store().level).toBe(1);
  });
});

describe('live-level loading state (drives the spinner)', () => {
  it('loads baked levels synchronously with no loading flash', () => {
    store().loadLevel(1); // baked
    expect(store().loading).toBe(false);
  });

  it('flags loading synchronously for a live level, then clears it after generation', async () => {
    store().loadLevel(LIVE_HIDDEN); // live tail — deferred generation
    // Header info updates immediately so the spinner screen shows the right level…
    expect(store().loading).toBe(true);
    expect(store().level).toBe(LIVE_HIDDEN);
    // …and the board arrives once generation finishes.
    await flushLoad();
    expect(store().loading).toBe(false);
    expect(store().current.bottles.length).toBeGreaterThan(0);
  });
});

describe('post-campaign "Play Random" mode', () => {
  it('enters endless mode (deferred, spinner) and generates a board', async () => {
    store().playRandom();
    expect(store().mode).toBe('endless');
    expect(store().loading).toBe(true);
    expect(store().endlessStreak).toBe(0);
    await flushLoad();
    expect(store().loading).toBe(false);
    expect(store().current.bottles.length).toBeGreaterThan(0);
  });

  it('counts an endless win toward the streak and persists the best', () => {
    // Put the store in endless mode one pour from a win (a plain, fully-revealed board).
    useGameStore.setState({
      mode: 'endless',
      endlessStreak: 2,
      endlessBestStreak: 2,
      current: board([['ruby', 'ruby', 'ruby'], ['ruby'], []], 4),
      initial: board([['ruby', 'ruby', 'ruby'], ['ruby'], []], 4),
      hidden: [[false, false, false], [false], []],
      initialHidden: [[false, false, false], [false], []],
      funnels: [null, null, null],
      initialFunnels: [null, null, null],
      ice: [[null, null, null], [null], []],
      initialIce: [[null, null, null], [null], []],
      history: [],
      hiddenHistory: [],
      moves: [],
      selected: null,
      status: 'playing',
      optimal: 1,
    });
    store().tapBottle(1); // pour the lone ruby onto the stack → completes the board
    store().tapBottle(0);
    expect(store().status).toBe('won');
    expect(store().endlessStreak).toBe(3);
    expect(store().endlessBestStreak).toBeGreaterThanOrEqual(3);
  });

  it('returns to campaign mode when a level is loaded', async () => {
    store().playRandom();
    await flushLoad(); // let the deferred endless board finish (no dangling timer)
    expect(store().mode).toBe('endless');
    store().loadLevel(1); // baked — synchronous
    expect(store().mode).toBe('campaign');
  });

  it('flows into the random mode (not a campaign level 61) after the last baked level', async () => {
    // Land on the final baked level and clear it the cheap way: set a trivially-winnable board.
    store().loadLevel(BAKED_LEVEL_COUNT);
    useGameStore.setState({
      current: board([['ruby', 'ruby', 'ruby'], ['ruby'], []], 4),
      initial: board([['ruby', 'ruby', 'ruby'], ['ruby'], []], 4),
      hidden: [[false, false, false], [false], []],
      initialHidden: [[false, false, false], [false], []],
      funnels: [null, null, null],
      initialFunnels: [null, null, null],
      ice: [[null, null, null], [null], []],
      initialIce: [[null, null, null], [null], []],
      history: [],
      hiddenHistory: [],
      moves: [],
      selected: null,
      status: 'playing',
      optimal: 1,
    });
    store().tapBottle(1);
    store().tapBottle(0);
    expect(store().status).toBe('won');
    expect(store().campaignComplete).toBe(true);
    // The frontier never advances past the baked campaign.
    expect(store().furthest).toBe(BAKED_LEVEL_COUNT);

    store().nextLevel();
    expect(store().mode).toBe('endless');
    expect(store().level).toBe(BAKED_LEVEL_COUNT); // not a phantom 61
    await flushLoad();
    expect(store().loading).toBe(false);
    expect(store().current.bottles.length).toBeGreaterThan(0);
  });
});

describe('cap-aware deadlock detection', () => {
  const commitBoard = (current: { bottles: string[][]; capacity: number }, hidden: boolean[][]) => {
    useGameStore.setState({
      initial: board(current.bottles, current.capacity),
      initialHidden: hidden,
      hidden,
      history: [],
      hiddenHistory: [],
      moves: [],
      selected: null,
    });
    store().restart(); // commits `initial` and recomputes status
  };

  it('flags deadlock when only capped tubes could "move" (no real player move)', () => {
    // ruby tube is capped; the other two are full, mismatched, and there is no empty — so the
    // player is stuck even though a naive check might count the capped tube as movable.
    commitBoard(
      {
        bottles: [
          ['ruby', 'ruby'], // capped
          ['amber', 'teal'],
          ['teal', 'amber'],
        ],
        capacity: 2,
      },
      [
        [false, false],
        [false, false],
        [false, false],
      ],
    );
    expect(store().status).toBe('deadlocked');
  });

  it('stays playing when a non-capped tube can still pour (capped tube ignored, not counted)', () => {
    commitBoard(
      {
        bottles: [['ruby', 'ruby'], ['emerald', 'sapphire'], ['sapphire', 'emerald'], []],
        capacity: 2,
      },
      [[false, false], [false, false], [false, false], []],
    );
    expect(store().status).toBe('playing');
  });
});

describe('capped (finished) tubes', () => {
  it('cannot be selected, poured out of, or poured into', () => {
    useGameStore.setState({
      current: board(
        [
          ['ruby', 'ruby', 'ruby', 'ruby'], // full single color -> capped
          ['amber', 'amber'],
        ],
        4,
      ),
      hidden: [
        [false, false, false, false],
        [false, false],
      ],
      hiddenHistory: [],
      history: [],
      moves: [],
      selected: null,
      status: 'playing',
    });

    // Tapping the capped tube selects nothing.
    store().tapBottle(0);
    expect(store().selected).toBeNull();

    // Selecting the other tube then tapping the capped one neither pours nor reselects it.
    store().tapBottle(1);
    expect(store().selected).toBe(1);
    store().tapBottle(0);
    expect(store().selected).toBeNull();
    expect(store().moves).toHaveLength(0); // no pour into the capped tube
  });
});

describe('frozen tubes (chapter 3)', () => {
  it('a frozen tube cannot be poured from, and thaws when its trigger color is capped', () => {
    // Tube 0 is full ruby but frozen with trigger teal; teal is not yet capped, so tube 0 is inert.
    // Capping teal (pouring the two loose teal cells together) thaws tube 0 and completes the board.
    const ice = [[color('teal'), color('teal')], [null], [null]];
    useGameStore.setState({
      current: board([['ruby', 'ruby'], ['teal'], ['teal']], 2),
      initial: board([['ruby', 'ruby'], ['teal'], ['teal']], 2),
      hidden: [[false, false], [false], [false]],
      initialHidden: [[false, false], [false], [false]],
      funnels: [null, null, null],
      initialFunnels: [null, null, null],
      ice,
      initialIce: ice,
      history: [],
      hiddenHistory: [],
      moves: [],
      selected: null,
      status: 'playing',
      optimal: 1,
    });

    // The frozen tube has nothing pourable → tapping it selects nothing.
    store().tapBottle(0);
    expect(store().selected).toBeNull();

    // Cap teal by stacking the two loose teal cells → tube 0 thaws and the board is won.
    store().tapBottle(2);
    store().tapBottle(1);
    expect(store().status).toBe('won');
  });

  it('does not count a board with frozen ice as won, even if structurally sorted', () => {
    // Both tubes are structurally complete, but tube 0 holds ice whose trigger color is one the board
    // can never hold, so it can never cap — the board is NOT won (a genuine deadlock, nothing thaws it).
    //
    // The trigger is deliberately a NON-palette color ('never'). `restart()` re-rolls the board's two
    // colors across the whole 12-hue palette (`recolorBoard`), so a palette trigger that's merely absent
    // here (e.g. amber) could be re-introduced onto a tube by the re-roll — thawing the ice and making
    // the sorted board read as won (a ~1-in-N flake). A non-palette trigger can never be produced by the
    // recolor, so the ice stays frozen on every re-roll.
    const ice = [[color('never'), color('never')], [null, null]];
    useGameStore.setState({
      current: board([['ruby', 'ruby'], ['teal', 'teal']], 2),
      initial: board([['ruby', 'ruby'], ['teal', 'teal']], 2),
      hidden: [[false, false], [false, false]],
      initialHidden: [[false, false], [false, false]],
      funnels: [null, null],
      initialFunnels: [null, null],
      ice,
      initialIce: ice,
      history: [],
      hiddenHistory: [],
      moves: [],
      selected: null,
      status: 'playing',
      optimal: 1,
    });
    store().restart(); // recomputes status from the committed board
    expect(store().status).not.toBe('won');
  });
});

describe('hidden colors (chapter 1)', () => {
  const anyHidden = (g: boolean[][]) => g.some((col) => col.some(Boolean));

  it('chapter-0 levels conceal nothing; chapter-1 levels do', async () => {
    store().loadLevel(1); // baked — synchronous
    expect(anyHidden(store().hidden)).toBe(false);
    store().loadLevel(LIVE_HIDDEN); // live tail — deferred
    await flushLoad();
    expect(anyHidden(store().hidden)).toBe(true);
  });

  // The key guarantee: even though pours are capped to the visible run, a hidden level is
  // still beatable. We drive the full-info solution as repeated capped pours — each concealed
  // cell in a run is the same color, so it reveals and pours on the next tap.
  it.each([LIVE_HIDDEN, LIVE_HIDDEN_2])('hidden level %i is solvable through the capped tap interface', async (level) => {
    store().loadLevel(level);
    await flushLoad();
    expect(anyHidden(store().hidden)).toBe(true);

    // The store loads this level via `getLevel`, so drive that exact board's solution.
    for (const move of getLevel(level).solution) {
      for (let k = 0; k < move.count; k++) {
        const before = store().moves.length;
        store().tapBottle(move.from);
        store().tapBottle(move.to);
        if (store().moves.length === before) break; // visible run exhausted for this move
      }
      const sel = store().selected;
      if (sel !== null) store().tapBottle(sel); // clear any dangling selection
    }

    expect(store().status).toBe('won');
    expect(anyHidden(store().hidden)).toBe(false); // everything revealed by the end
  });

  it('a pour snapshots concealment and undo restores it; restart re-conceals', async () => {
    store().loadLevel(LIVE_HIDDEN);
    await flushLoad();
    const initialHidden = store().hidden;
    const concealedCount = (g: boolean[][]) => g.reduce((n, col) => n + col.filter(Boolean).length, 0);
    const startConcealed = concealedCount(initialHidden);
    const first = getLevel(LIVE_HIDDEN).solution[0]!;

    store().tapBottle(first.from);
    store().tapBottle(first.to);
    expect(store().hiddenHistory).toHaveLength(1);

    store().undo();
    expect(store().hiddenHistory).toHaveLength(0);
    expect(store().hidden).toEqual(initialHidden); // undo restores the grid exactly (no reshuffle)

    // Reveal something, then restart should bring concealment back to the start.
    store().tapBottle(first.from);
    store().tapBottle(first.to);
    store().restart();
    // Restart reshuffles tube order, so the grid isn't identical — but it re-conceals every cell,
    // restoring the starting count of concealed cells.
    expect(concealedCount(store().hidden)).toBe(startConcealed);
    expect(store().hiddenHistory).toHaveLength(0);
  });
});

describe('tapBottle selection', () => {
  it('selects a non-empty bottle, ignores empty bottles', () => {
    const emptyIndex = store().current.bottles.findIndex((b) => b.length === 0);
    store().tapBottle(emptyIndex);
    expect(store().selected).toBeNull();

    const fullIndex = store().current.bottles.findIndex((b) => b.length > 0);
    store().tapBottle(fullIndex);
    expect(store().selected).toBe(fullIndex);
  });

  it('deselects when the same bottle is tapped twice', () => {
    const i = store().current.bottles.findIndex((b) => b.length > 0);
    store().tapBottle(i);
    store().tapBottle(i);
    expect(store().selected).toBeNull();
  });
});

describe('pour via taps', () => {
  it('records history and a move when a legal pour is tapped', () => {
    const first = referenceSolution[0]!;
    store().tapBottle(first.from);
    store().tapBottle(first.to);
    expect(store().history).toHaveLength(1);
    expect(store().moves).toHaveLength(1);
    expect(store().selected).toBeNull();
  });

  it('playing the stored solution reaches the won state', () => {
    playSolution();
    expect(store().status).toBe('won');
  });
});

describe('undo / restart', () => {
  it('undo reverts the last pour', () => {
    const before = store().current.bottles;
    const first = referenceSolution[0]!;
    store().tapBottle(first.from);
    store().tapBottle(first.to);
    store().undo();
    expect(store().current.bottles).toEqual(before);
    expect(store().history).toHaveLength(0);
    expect(store().moves).toHaveLength(0);
  });

  it('undo is a no-op with empty history', () => {
    store().undo();
    expect(store().history).toHaveLength(0);
  });

  it('restart returns to the same puzzle (re-rolling colors and tube order)', () => {
    playSolution();
    store().restart();
    expect(store().status).toBe('playing');
    expect(store().history).toHaveLength(0);
    // The board is recolored AND its tubes reordered, so positions/ids differ — but it's the same
    // puzzle: solvable, with an identical optimal solution length (both are permutation-invariant).
    expect(isSolvable(store().current)).toBe(true);
    expect(optimalCappedMoves(store().current, store().hidden)).toBe(reference.optimal);
  });
});

describe('hint', () => {
  it('surfaces a hint that pulses two distinct tubes and marks the attempt', () => {
    store().requestHint();
    const h = store().hint;
    expect(h).not.toBeNull();
    expect(h!.from).not.toBe(h!.to);
    expect(store().hintUsed).toBe(true);
  });

  it('dismisses the pulse on the next tap but keeps the penalty for the attempt', () => {
    store().requestHint();
    const h = store().hint!;
    // The hinted pour, then an undo: dismisses the pulse and rewinds the board…
    store().tapBottle(h.from);
    store().tapBottle(h.to);
    expect(store().hint).toBeNull();
    store().undo();
    expect(store().moves).toHaveLength(0);
    // …but the 1-star penalty can't be laundered by undoing.
    expect(store().hintUsed).toBe(true);
  });

  it('caps a hinted solve to 1 star', () => {
    store().startOver(); // isolate level 1's recorded result from other tests' wins
    store().requestHint();
    playSolution();
    expect(store().status).toBe('won');
    expect(store().bestStars).toBe(1);
  });

  it('resets the penalty on restart', () => {
    store().requestHint();
    expect(store().hintUsed).toBe(true);
    store().restart();
    expect(store().hintUsed).toBe(false);
  });
});

describe('deadlock detection (genuine walls only)', () => {
  const seed = (bottles: string[][], capacity: number) => {
    const grid = bottles.map((b) => b.map(() => false));
    useGameStore.setState({
      initial: board(bottles, capacity),
      initialHidden: grid,
      hidden: grid,
      hiddenHistory: [],
      history: [],
      moves: [],
      selected: null,
    });
    store().restart(); // commits the seeded board and recomputes status
  };

  it('does NOT end the game when the board is unwinnable but moves remain', () => {
    // 5 reds + 5 greens interleaved — unwinnable, yet bottle 0 can still pour into bottle 2.
    // An earlier mistake must not auto-end the game; the player keeps their moves and can undo.
    seed(
      [
        ['ruby', 'emerald', 'ruby', 'emerald'],
        ['emerald', 'ruby', 'emerald', 'ruby'],
        ['ruby', 'emerald'],
      ],
      4,
    );
    expect(store().status).toBe('playing');
  });

  it('declares deadlock only when there is genuinely no legal move', () => {
    // Two full, mismatched tubes and no empty — nothing can be poured anywhere.
    seed([['ruby', 'emerald'], ['emerald', 'ruby']], 2);
    expect(store().status).toBe('deadlocked');
  });
});

describe('"going in circles" detection (soft loop)', () => {
  /** Every canonical board reachable from `start` under the solver's useful-move pruning. */
  const closureOf = (start: ReturnType<typeof board>): Set<string> => {
    const seen = new Set<string>([canonical(start)]);
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const { from, to } of usefulMoves(current)) {
        const { state: next } = pour(current, from, to);
        const key = canonical(next);
        if (!seen.has(key)) {
          seen.add(key);
          stack.push(next);
        }
      }
    }
    return seen;
  };

  // Unsolvable loop board: moves remain forever but it can never be won.
  const loop = () =>
    board(
      [
        ['ruby', 'emerald', 'ruby', 'emerald'],
        ['emerald', 'ruby', 'emerald', 'ruby'],
        ['ruby', 'emerald'],
      ],
      4,
    );

  it('stays playing while fresh boards are still reachable (a mistake does not end the game)', () => {
    // Only the start has been seen, so the player still has somewhere new to go.
    const grid = loop().bottles.map((b) => b.map(() => false));
    useGameStore.setState({
      current: loop(),
      initial: loop(),
      hidden: grid,
      initialHidden: grid,
      history: [],
      hiddenHistory: [],
      moves: [],
      selected: null,
    });
    store().restart(); // recomputes status with a fresh single-entry visited set
    expect(store().status).toBe('playing');
  });

  it('flags "stuck" once every reachable board has already been visited', () => {
    const A = loop();
    const { from, to } = usefulMoves(A)[0]!;
    const { state: B, move } = pour(A, from, to);
    const gridA = A.bottles.map((b) => b.map(() => false));
    const gridB = B.bottles.map((b) => b.map(() => false));
    // Sit on B with A as the prior board and the WHOLE closure already visited; undoing back to A
    // recomputes status — A's every reachable board is in `visited` and none wins → going in circles.
    useGameStore.setState({
      current: B,
      initial: A,
      hidden: gridB,
      initialHidden: gridA,
      history: [A],
      hiddenHistory: [gridA],
      moves: [move],
      undos: 0,
      visited: closureOf(A),
      selected: null,
    });
    store().undo();
    expect(store().status).toBe('stuck');
  });
});

describe('undos count toward the star rating', () => {
  it('an undo increments `undos` while rewinding the move', () => {
    const first = referenceSolution[0]!;
    store().tapBottle(first.from);
    store().tapBottle(first.to);
    expect(store().moves).toHaveLength(1);
    expect(store().undos).toBe(0);

    store().undo();
    expect(store().moves).toHaveLength(0);
    expect(store().undos).toBe(1);
  });

  it('records best = real moves + undos used (undoing costs rating)', () => {
    // Reset the (singleton) campaign so an earlier test's level-1 best can't min-out this score.
    store().startOver();
    // A throwaway pour then undo (undos = 1), then a clean optimal solve.
    const t = referenceSolution[0]!;
    store().tapBottle(t.from);
    store().tapBottle(t.to);
    store().undo();
    playSolution();

    expect(store().status).toBe('won');
    expect(store().undos).toBe(1);
    expect(store().best).toBe(referenceSolution.length + 1);
  });
});

describe('color-locked funnels (chapter 2)', () => {
  // Past the baked campaign, play plateaus in the final defined chapter — which carries the funnel
  // mechanic — so these live (plateau) boards exercise the funnel wiring without depending on a
  // specific committed board. Live levels generate on a deferred macrotask, hence the flush.
  it('loads a funneled board whose tints ride the SAME recolor bijection as the liquid', async () => {
    // Find a plateau level that actually got funnels (deterministic per level number).
    let funneled = false;
    for (let k = 1; k <= 12 && !funneled; k++) {
      store().loadLevel(BAKED_LEVEL_COUNT + k);
      await flushLoad();
      funneled = store().funnels.some((t) => t != null);
    }
    const s = store();
    expect(s.mechanics).toContain('funnel');
    expect(funneled).toBe(true); // the chapter actually applied at least one funnel
    expect(s.funnels.length).toBe(s.current.bottles.length); // one entry per tube

    // The recolor subtlety: every funnel tint must be a color that actually appears on the recolored
    // board. If funnels were remapped with a different bijection than the liquid, the tint would be an
    // orphan hue absent from the board — this asserts they share one map.
    const boardColors = new Set<string>(s.current.bottles.flat());
    for (const tint of s.funnels) {
      if (tint != null) expect(boardColors.has(tint)).toBe(true);
    }
  });

  it('rejects a pour into a funnel tube whose tint does not match the poured color', async () => {
    let target: { store: ReturnType<typeof store>; from: number; to: number } | null = null;
    for (let k = 1; k <= 12 && !target; k++) {
      store().loadLevel(BAKED_LEVEL_COUNT + k);
      await flushLoad();
      const s = store();
      // Look for an immediately-available pour the engine allows but a funnel should block: source
      // top color X, destination is a funnel tube tinted to some other color, with room.
      for (let from = 0; from < s.current.bottles.length && !target; from++) {
        const src = s.current.bottles[from]!;
        if (src.length === 0) continue;
        const top = src[src.length - 1]!;
        for (let to = 0; to < s.current.bottles.length; to++) {
          if (to === from) continue;
          const tint = s.funnels[to];
          const dst = s.current.bottles[to]!;
          const hasRoom = dst.length < s.current.capacity;
          const colorOk = dst.length === 0 || dst[dst.length - 1] === top;
          if (tint != null && tint !== top && hasRoom && colorOk) {
            target = { store: s, from, to };
            break;
          }
        }
      }
    }
    // Some seeds may not surface such a pour on the opening board; only assert when one exists.
    if (target) {
      const before = target.store.moves.length;
      target.store.tapBottle(target.from);
      target.store.tapBottle(target.to);
      // The funnel rejected the pour: no move recorded (the second tap just re-selected/cleared).
      expect(store().moves.length).toBe(before);
    }
  });
});
