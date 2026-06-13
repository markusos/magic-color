import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore, __setDeadlockMonitor } from './gameStore';
import { createDeadlockMonitor, type DeadlockMonitor } from './deadlockMonitor';
import { createLevel } from '../game/levels';

const store = () => useGameStore.getState();

// Generation is deterministic by seed, so the store's board for ('normal', 1) is
// identical to this independently-generated level — including its known solution.
const SEED = 1;
const reference = createLevel('normal', SEED);

// Inject a zero-debounce, in-process monitor so the async deadlock check resolves fast
// and deterministically (no Web Worker in the test environment).
let testMonitor: DeadlockMonitor;

beforeEach(() => {
  testMonitor = createDeadlockMonitor({ debounceMs: 0 });
  __setDeadlockMonitor(testMonitor);
  store().newGame('normal', SEED);
});

afterEach(() => {
  // Drop any pending/in-flight check so it can't leak into the next test.
  testMonitor.cancel();
});

/** Drive a list of engine moves through the tap interface (select source, tap target). */
function playSolution() {
  for (const move of reference.solution) {
    store().tapBottle(move.from);
    store().tapBottle(move.to);
  }
}

describe('newGame', () => {
  it('starts in the playing state with a positive par', () => {
    const s = store();
    expect(s.status).toBe('playing');
    expect(s.par).toBe(reference.minMoves);
    expect(s.current.bottles).toEqual(reference.state.bottles);
    expect(s.history).toHaveLength(0);
    expect(s.selected).toBeNull();
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

  it('restart returns to the initial board', () => {
    playSolution();
    store().restart();
    expect(store().current.bottles).toEqual(reference.state.bottles);
    expect(store().status).toBe('playing');
    expect(store().history).toHaveLength(0);
  });
});

describe('deadlock detection', () => {
  it('ends the game when the board becomes a stuck loop (moves remain but unwinnable)', async () => {
    // 5 reds + 5 greens at capacity 4 — unwinnable, yet bottle 0 can still pour into 2.
    const stuck = {
      bottles: [
        ['ruby', 'emerald', 'ruby', 'emerald'],
        ['emerald', 'ruby', 'emerald', 'ruby'],
        ['ruby', 'emerald'],
      ],
      capacity: 4,
    };
    // Seed it as the initial board, then restart() commits it.
    useGameStore.setState({ initial: stuck });
    store().restart();
    // Status is optimistically "playing" until the debounced worker check returns...
    expect(store().status).toBe('playing');
    // ...then it flips to "deadlocked".
    await vi.waitFor(() => expect(store().status).toBe('deadlocked'));
  });

  it('does not flag a solvable board as deadlocked', async () => {
    store().newGame('normal', SEED);
    // Give the debounced check time to run; a solvable board must stay playable.
    await new Promise((r) => setTimeout(r, 10));
    expect(store().status).toBe('playing');
  });
});

describe('addEmptyTube', () => {
  it('appends an empty bottle and can be undone', () => {
    const count = store().current.bottles.length;
    store().addEmptyTube();
    expect(store().current.bottles).toHaveLength(count + 1);
    expect(store().current.bottles[count]).toEqual([]);
    store().undo();
    expect(store().current.bottles).toHaveLength(count);
  });
});
