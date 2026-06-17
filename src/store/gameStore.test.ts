import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { generateForLevel } from '../game/progression';
import { board } from '../test/board';

const store = () => useGameStore.getState();

// Generation is deterministic by level, so the store's board for level 1 has the same *layout*
// as this independently-generated level — including its known solution. The displayed colors are
// randomized per load (see recolor.ts), so board comparisons go through `sameLayout`, which checks
// equality up to a consistent color renaming rather than exact ids.
const LEVEL = 1;
const reference = generateForLevel(LEVEL);

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
  for (const move of reference.solution) {
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
    for (const move of reference.solution) {
      store().tapBottle(move.from);
      store().tapBottle(move.to);
    }
    expect(store().status).toBe('won');
    expect(store().best).toBe(reference.solution.length);

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

  it('chapter-0 levels conceal nothing; chapter-1 levels do', () => {
    store().loadLevel(1);
    expect(anyHidden(store().hidden)).toBe(false);
    store().loadLevel(75);
    expect(anyHidden(store().hidden)).toBe(true);
  });

  // The key guarantee: even though pours are capped to the visible run, a hidden level is
  // still beatable. We drive the full-info solution as repeated capped pours — each concealed
  // cell in a run is the same color, so it reveals and pours on the next tap.
  it.each([75, 145])('hidden level %i is solvable through the capped tap interface', (level) => {
    store().loadLevel(level);
    expect(anyHidden(store().hidden)).toBe(true);

    for (const move of generateForLevel(level).solution) {
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

  it('a pour snapshots concealment and undo restores it; restart re-conceals', () => {
    store().loadLevel(75);
    const initialHidden = store().hidden;
    const first = generateForLevel(75).solution[0]!;

    store().tapBottle(first.from);
    store().tapBottle(first.to);
    expect(store().hiddenHistory).toHaveLength(1);

    store().undo();
    expect(store().hiddenHistory).toHaveLength(0);
    expect(store().hidden).toEqual(initialHidden);

    // Reveal something, then restart should bring concealment back to the start.
    store().tapBottle(first.from);
    store().tapBottle(first.to);
    store().restart();
    expect(store().hidden).toEqual(initialHidden);
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
    const first = reference.solution[0]!;
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
    const first = reference.solution[0]!;
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

  it('restart returns to the initial layout (re-rolling colors)', () => {
    playSolution();
    store().restart();
    expect(sameLayout(store().current.bottles, reference.state.bottles)).toBe(true);
    expect(store().status).toBe('playing');
    expect(store().history).toHaveLength(0);
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
