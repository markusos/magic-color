import { describe, it, expect } from 'vitest';
import { cueForTap, deriveStatus, planTap } from './session';
import { emptyOverlays, type OverlaySet } from '../game/mechanics';
import { canonical } from '../game/solver';
import { board, color } from '../test/board';
import { emptyGrid } from '../game/hidden';
import { noIce } from '../game/ice';
import type { GameState } from '../game/types';

/** Clean (no-mechanic) overlays for a board, optionally with field overrides. */
function overlays(state: GameState, over: Partial<OverlaySet> = {}): OverlaySet {
  return { ...emptyOverlays(state), ...over };
}

describe('deriveStatus', () => {
  it('reports a fully-sorted board as won', () => {
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    expect(deriveStatus(state, overlays(state))).toBe('won');
  });

  it('is still playing while a concealed cell remains, even if the colors already match', () => {
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    const hidden = [[false, true, false, false], []];
    expect(deriveStatus(state, overlays(state, { hidden }))).toBe('playing');
  });

  it('is still playing while a frozen cell remains', () => {
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    // A floor cell tinted by a trigger color that is NOT yet capped stays frozen.
    const ice = [[color('b'), null, null, null], []];
    expect(deriveStatus(state, overlays(state, { ice }))).toBe('playing');
  });

  it('reports a color-sorted board as deadlocked when remaining ice can no longer be thawed', () => {
    // Both tubes are full single-color (so `isWon` is true), but tube 0 is frozen to the top by a
    // trigger ('g') that nothing on the board can ever cap. No pour is possible (every top is frozen or
    // full), so the player is genuinely out of moves — not "still playing".
    const state = board([['r', 'r', 'r', 'r'], ['b', 'b', 'b', 'b']], 4);
    const ice = [[color('g'), color('g'), color('g'), color('g')], []];
    expect(deriveStatus(state, overlays(state, { ice }))).toBe('deadlocked');
  });

  it('stays playing when a sorted-but-frozen board still has a move that can free the ice', () => {
    // Tube 0 is full red with a frozen floor; the red above the ice can still be poured into the empty
    // tube, so the board is not out of moves even though ice keeps it unfinished.
    const state = board([['r', 'r', 'r', 'r'], []], 4);
    const ice = [[color('b'), null, null, null], []];
    expect(deriveStatus(state, overlays(state, { ice }))).toBe('playing');
  });

  it('does not count a frozen-topped tube as a source even when its color matches an open tube', () => {
    // Tube 0 is full red but frozen to the top by a trigger ('g') nothing can cap, so its (red) top
    // can't move. Tube 1 is open red with room — the colors MATCH, but the only pour the match implies
    // is tube0 -> tube1, which is illegal (frozen source). Tube 1 has nowhere else to go (tube 0 is
    // full), so the board is genuinely out of moves.
    const state = board([['r', 'r', 'r', 'r'], ['r', 'r']], 4);
    const ice = [[color('g'), color('g'), color('g'), color('g')], []];
    expect(deriveStatus(state, overlays(state, { ice }))).toBe('deadlocked');
  });

  it('reports a board with no legal move as deadlocked', () => {
    // Two full tubes of clashing colors, no empty: nothing can be poured anywhere.
    const state = board([['r', 'b', 'r', 'b'], ['b', 'r', 'b', 'r']], 4);
    expect(deriveStatus(state, overlays(state))).toBe('deadlocked');
  });

  it('reports an ordinary mid-game board as playing', () => {
    const state = board([['r', 'b'], ['b', 'r'], []], 4);
    expect(deriveStatus(state, overlays(state))).toBe('playing');
  });

  it('reports stuck only when the injected loop check fires', () => {
    // The check itself lives core-side (see gameStore/wasmStuck); here we just verify the
    // injection seam: a firing check flips a playable board to stuck, an absent or quiet one
    // never does.
    const state = board([['r', 'b'], ['b', 'r'], []], 4);
    expect(deriveStatus(state, overlays(state), () => true)).toBe('stuck');
    expect(deriveStatus(state, overlays(state), () => false)).toBe('playing');
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

describe('cueForTap', () => {
  const grids = (state: GameState) => ({ hidden: emptyGrid(state), ice: noIce(state) });

  it('plays the select cue when picking up a tube', () => {
    const state = board([['r'], []], 4);
    const plan = planTap(state, overlays(state), null, 0);
    const { hidden, ice } = grids(state);
    expect(cueForTap(plan, state, hidden, ice, 'playing', null, 0)).toBe('select');
  });

  it('stays silent on an ignored tap (no selection, empty tube)', () => {
    const state = board([['r'], []], 4);
    const plan = planTap(state, overlays(state), null, 1);
    const { hidden, ice } = grids(state);
    expect(cueForTap(plan, state, hidden, ice, 'playing', null, 1)).toBeNull();
  });

  it('plays deselect when re-tapping the selected tube', () => {
    const state = board([['r'], []], 4);
    const plan = planTap(state, overlays(state), 0, 0);
    const { hidden, ice } = grids(state);
    expect(cueForTap(plan, state, hidden, ice, 'playing', 0, 0)).toBe('deselect');
  });

  it('plays invalid when a deselect comes from an illegal pour onto another tube', () => {
    // Tube 1 is empty and funnel-locked to green, so r can't pour in and the selection clears — an
    // illegal-pour deselect (i !== selected), which should thud rather than read as a plain cancel.
    const state = board([['r'], []], 4);
    const funnels = [null, color('g')];
    const plan = planTap(state, overlays(state, { funnels }), 0, 1);
    expect(plan).toEqual({ kind: 'deselect' });
    const { hidden, ice } = grids(state);
    expect(cueForTap(plan, state, hidden, ice, 'playing', 0, 1)).toBe('invalid');
  });

  it('plays a plain pour cue for an ordinary pour', () => {
    const state = board([['r', 'b'], [], []], 4);
    const plan = planTap(state, overlays(state), 0, 1);
    const { hidden, ice } = grids(state);
    expect(cueForTap(plan, state, hidden, ice, 'playing', 0, 1)).toBe('pour');
  });

  it('plays the cap cue when a pour completes a color', () => {
    // Pouring the single r onto three r's fills tube 1 to a finished color; tube 2 keeps the board
    // unfinished so the status stays 'playing' and the cap branch (not the win branch) is exercised.
    const state = board([['r'], ['r', 'r', 'r'], ['b', 'g']], 4);
    const plan = planTap(state, overlays(state), 0, 1);
    const { hidden, ice } = grids(state);
    expect(cueForTap(plan, state, hidden, ice, 'playing', 0, 1)).toBe('cap');
  });

  it('plays the win cue when the resulting status is won', () => {
    const state = board([['r'], ['r', 'r', 'r'], ['b', 'b', 'b', 'b']], 4);
    const plan = planTap(state, overlays(state), 0, 1);
    // The store passes the post-pour status; here the pour finishes the board.
    const { hidden, ice } = grids(state);
    expect(cueForTap(plan, state, hidden, ice, 'won', 0, 1)).toBe('win');
  });

  it('plays the thaw cue when a pour caps a trigger and frees ice', () => {
    // Pour the (unfrozen) single r onto three r's: tube 1 finishes red, the trigger tinting tube 2's
    // frozen floor cell, so it thaws. Thaw outranks the cap that caused it.
    const state = board([['r'], ['r', 'r', 'r'], ['b', 'b']], 4);
    const ice = [[null], [null, null, null], [color('r'), null]];
    const plan = planTap(state, overlays(state, { ice }), 0, 1);
    const hidden = emptyGrid(state);
    expect(cueForTap(plan, state, hidden, ice, 'playing', 0, 1)).toBe('thaw');
  });
});
