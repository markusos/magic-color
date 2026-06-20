import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { BAKED_LEVEL_COUNT, getLevel } from '../game/levelLoader';
import { isSolvable, solve } from '../game/solver';
import { optimalCappedMoves } from '../game/search';
import { board } from '../test/board';

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
 * blocking generation to a macrotask so the UI can paint a spinner. Tests that load such a level
 * await this to let that deferred work run. Baked levels load synchronously and need no flush.
 */
const flushLoad = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
    store().loadLevel(75); // live tail — deferred generation
    // Header info updates immediately so the spinner screen shows the right level…
    expect(store().loading).toBe(true);
    expect(store().level).toBe(75);
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

describe('hidden colors (chapter 1)', () => {
  const anyHidden = (g: boolean[][]) => g.some((col) => col.some(Boolean));

  it('chapter-0 levels conceal nothing; chapter-1 levels do', async () => {
    store().loadLevel(1); // baked — synchronous
    expect(anyHidden(store().hidden)).toBe(false);
    store().loadLevel(75); // live tail — deferred
    await flushLoad();
    expect(anyHidden(store().hidden)).toBe(true);
  });

  // The key guarantee: even though pours are capped to the visible run, a hidden level is
  // still beatable. We drive the full-info solution as repeated capped pours — each concealed
  // cell in a run is the same color, so it reveals and pours on the next tap.
  it.each([75, 145])('hidden level %i is solvable through the capped tap interface', async (level) => {
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
    store().loadLevel(75);
    await flushLoad();
    const initialHidden = store().hidden;
    const concealedCount = (g: boolean[][]) => g.reduce((n, col) => n + col.filter(Boolean).length, 0);
    const startConcealed = concealedCount(initialHidden);
    const first = getLevel(75).solution[0]!;

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
