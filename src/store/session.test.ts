import { describe, it, expect } from 'vitest';
import { deriveStatus, planTap } from './session';
import { emptyOverlays, type OverlaySet } from '../game/mechanics';
import { canonical } from '../game/solver';
import { board, color } from '../test/board';
import type { GameState } from '../game/types';

/** Clean (no-mechanic) overlays for a board, optionally with field overrides. */
function overlays(state: GameState, over: Partial<OverlaySet> = {}): OverlaySet {
  return { ...emptyOverlays(state), ...over };
}

describe('deriveStatus', () => {
  it('reports a fully-sorted board as won', () => {
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    expect(deriveStatus(state, overlays(state), new Set())).toBe('won');
  });

  it('is still playing while a concealed cell remains, even if the colors already match', () => {
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    const hidden = [[false, true, false, false], []];
    expect(deriveStatus(state, overlays(state, { hidden }), new Set())).toBe('playing');
  });

  it('is still playing while a frozen cell remains', () => {
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    // A floor cell tinted by a trigger color that is NOT yet capped stays frozen.
    const ice = [[color('b'), null, null, null], []];
    expect(deriveStatus(state, overlays(state, { ice }), new Set())).toBe('playing');
  });

  it('reports a board with no legal move as deadlocked', () => {
    // Two full tubes of clashing colors, no empty: nothing can be poured anywhere.
    const state = board([['r', 'b', 'r', 'b'], ['b', 'r', 'b', 'r']], 4);
    expect(deriveStatus(state, overlays(state), new Set())).toBe('deadlocked');
  });

  it('reports an ordinary mid-game board as playing', () => {
    const state = board([['r', 'b'], ['b', 'r'], []], 4);
    expect(deriveStatus(state, overlays(state), new Set())).toBe('playing');
  });
});

describe('planTap', () => {
  it('selects a pourable bottle when nothing is selected', () => {
    const state = board([['r'], []], 4);
    expect(planTap(state, overlays(state), null, 0)).toEqual({ kind: 'select', selected: 0 });
  });

  it('ignores a tap on an empty bottle when nothing is selected', () => {
    const state = board([['r'], []], 4);
    expect(planTap(state, overlays(state), null, 1)).toEqual({ kind: 'ignore' });
  });

  it('deselects when the selected bottle is tapped again', () => {
    const state = board([['r'], []], 4);
    expect(planTap(state, overlays(state), 0, 0)).toEqual({ kind: 'deselect' });
  });

  it('pours the whole visible run into an empty bottle', () => {
    const state = board([['r', 'r'], ['b'], []], 4);
    const plan = planTap(state, overlays(state), 0, 2);
    expect(plan.kind).toBe('pour');
    if (plan.kind !== 'pour') return;
    expect(plan.move.count).toBe(2);
    expect(plan.next.bottles[2]).toEqual([color('r'), color('r')]);
    expect(plan.next.bottles[0]).toEqual([]);
  });

  it('caps the pour at the visible run when a concealed cell breaks it', () => {
    const state = board([['r', 'r', 'r'], []], 4);
    // Conceal the middle cell: the visible top run is just the single top 'r'.
    const hidden = [[false, true, false], []];
    const plan = planTap(state, overlays(state, { hidden }), 0, 1);
    expect(plan.kind).toBe('pour');
    if (plan.kind !== 'pour') return;
    expect(plan.move.count).toBe(1);
    expect(plan.next.bottles[1]).toEqual([color('r')]);
  });

  it('reselects when the tapped destination cannot receive the pour', () => {
    const state = board([['r'], ['b', 'b'], []], 4);
    // Pouring r onto b is illegal, but tube 1 is itself a valid source → reselect it.
    expect(planTap(state, overlays(state), 0, 1)).toEqual({ kind: 'select', selected: 1 });
  });

  it('rejects a pour into a funnel locked to another color (deselects)', () => {
    const state = board([['r'], []], 4);
    // Tube 1 is empty and funnel-locked to green: r may not pour in, and an empty tube is not a
    // reselect target, so the selection clears.
    const funnels = [null, color('g')];
    expect(planTap(state, overlays(state, { funnels }), 0, 1)).toEqual({ kind: 'deselect' });
  });

  it('produces a next board with a distinct canonical key from the source', () => {
    // Merging two runs of the same color changes the multiset of bottles (unlike moving a whole run
    // to an empty tube, which is order-only and so canonically identical).
    const state = board([['r', 'r'], ['r'], []], 4);
    const plan = planTap(state, overlays(state), 0, 1);
    if (plan.kind !== 'pour') throw new Error('expected a pour');
    expect(canonical(plan.next)).not.toBe(canonical(state));
  });
});
