import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDeadlockMonitor } from './deadlockMonitor';
import type { GameState } from '../game/types';

const board = (id: string): GameState => ({ bottles: [[id]], capacity: 4 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createDeadlockMonitor', () => {
  it('runs the check after the debounce window and reports the result', async () => {
    const m = createDeadlockMonitor({ debounceMs: 100, check: async () => true });
    let result: boolean | undefined;
    m.schedule(board('a'), (r) => (result = r));

    expect(result).toBeUndefined(); // not yet — still within debounce
    await vi.advanceTimersByTimeAsync(100);
    expect(result).toBe(true);
  });

  it('debounces rapid schedules: only the latest board is checked', async () => {
    const check = vi.fn(async (_state: GameState) => false);
    const m = createDeadlockMonitor({ debounceMs: 100, check });
    const results: boolean[] = [];

    m.schedule(board('a'), (r) => results.push(r));
    m.schedule(board('b'), (r) => results.push(r));
    await vi.advanceTimersByTimeAsync(100);

    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0]![0]).toEqual(board('b'));
    expect(results).toEqual([false]);
  });

  it('drops a stale in-flight result when a newer schedule supersedes it', async () => {
    let resolveFirst: ((v: boolean) => void) | undefined;
    const check = vi.fn((s: GameState) =>
      s.bottles[0]![0] === 'a'
        ? new Promise<boolean>((res) => (resolveFirst = res))
        : Promise.resolve(false),
    );
    const m = createDeadlockMonitor({ debounceMs: 10, check });
    const results: string[] = [];

    m.schedule(board('a'), (r) => results.push(`a:${r}`));
    await vi.advanceTimersByTimeAsync(10); // fires check('a'), left pending

    m.schedule(board('b'), (r) => results.push(`b:${r}`));
    await vi.advanceTimersByTimeAsync(10); // fires check('b') -> false

    resolveFirst!(true); // 'a' resolves late
    await Promise.resolve();

    expect(results).toEqual(['b:false']); // the stale 'a' result is discarded
  });

  it('cancel() prevents a pending check from running', async () => {
    const check = vi.fn(async () => true);
    const m = createDeadlockMonitor({ debounceMs: 50, check });
    let called = false;
    m.schedule(board('a'), () => (called = true));

    m.cancel();
    await vi.advanceTimersByTimeAsync(50);

    expect(check).not.toHaveBeenCalled();
    expect(called).toBe(false);
  });
});
