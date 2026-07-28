/**
 * The shared solver seam. jsdom has no `Worker`, so the app's own specs only ever exercise the
 * synchronous fallback — these stub one in to drive the OFF-THREAD path, which is where request
 * routing actually matters: the worker is reused, its handlers are overwritten per call, and its
 * replies used to carry nothing that said which solve they answered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HintWorkerReply, HintWorkerRequest } from '../game/coreWasm';
import { board } from '../test/board';

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((e: MessageEvent<HintWorkerReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: HintWorkerRequest[] = [];

  constructor() {
    FakeWorker.last = this;
  }
  postMessage(req: HintWorkerRequest): void {
    this.posted.push(req);
  }
  /** Deliver a reply for `id`, as the real worker would. */
  reply(id: number, move: { from: number; to: number } | null): void {
    this.onmessage?.({ data: { id, move } } as MessageEvent<HintWorkerReply>);
  }
}

vi.stubGlobal('Worker', FakeWorker);
const { solveMove } = await import('./solverWorker');

const req = {
  state: board([['r', 'g'], ['g', 'r'], []]),
  hidden: [[], [], []],
  overlays: {},
  maxNodes: 1000,
};
const worker = () => FakeWorker.last!;

beforeEach(() => {
  FakeWorker.last?.posted.splice(0);
});

describe('reply routing', () => {
  it('delivers an answer to the solve that asked for it', () => {
    const onResult = vi.fn();
    solveMove(req, onResult);
    const { id } = worker().posted.at(-1)!;
    worker().reply(id, { from: 0, to: 2 });
    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith({ from: 0, to: 2 });
  });

  // Cancelling an auto-solve run does NOT recall a postMessage already sitting in the worker, so a
  // hint can genuinely start while the previous solve is unanswered. The old caller must be told it
  // has been dropped — left waiting, a hint's in-flight guard never clears and the button goes dead.
  it('unwinds the previous caller when a new solve takes the worker', () => {
    const first = vi.fn();
    const second = vi.fn();
    solveMove(req, first);
    const firstId = worker().posted.at(-1)!.id;

    solveMove(req, second);
    expect(first).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledWith(null, true); // superseded, not a "no move" verdict
    expect(second).not.toHaveBeenCalled();

    // The abandoned solve's answer must not be handed to the new caller.
    worker().reply(firstId, { from: 9, to: 9 });
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledOnce();

    const secondId = worker().posted.at(-1)!.id;
    expect(secondId).not.toBe(firstId);
    worker().reply(secondId, { from: 0, to: 2 });
    expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith({ from: 0, to: 2 });
  });

  it('ignores a duplicate reply for an already-settled solve', () => {
    const onResult = vi.fn();
    solveMove(req, onResult);
    const { id } = worker().posted.at(-1)!;
    worker().reply(id, null);
    worker().reply(id, { from: 0, to: 2 });
    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(null);
  });
});
