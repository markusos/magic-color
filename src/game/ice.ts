/**
 * The "frozen tubes" mechanic (chapter 3+). A tube can start with its bottom region encased in a
 * block of ice — the bottom `k` segments, from the floor up to an "ice line." A frozen segment can't
 * be poured and blocks everything below the ice line (you pour the free liquid *above* the ice
 * normally), and a tube holding ice is never "capped" (finished), exactly like a hidden `?`. The
 * whole block is tinted one **trigger color** and thaws — all at once — the instant that color is
 * **capped** (a tube is finished in that color). The tint *is* the liquid that melts it.
 *
 * Like {@link ./hidden} and {@link ./funnels}, this is a parallel overlay, NOT an engine change: the
 * pure engine stays mechanic-unaware. Two design choices keep it cheap:
 *
 * 1. **Freeze the whole region, not just the blocking cell.** Mechanically only the *topmost* frozen
 *    segment (the ice line) matters — it already blocks everything beneath it, and those can't move
 *    regardless — so filling the block down to the floor is purely visual; the run-cap stops at the
 *    ice line and capping is blocked either way. Each tube's ice is therefore one contiguous bottom
 *    block of a single trigger color.
 *
 * 2. **The frozen state is DERIVED, not carried.** A color is "capped" ⟺ a *capped* tube of that
 *    color currently exists, and capping is permanent (a capped tube is finished, never re-poured), so
 *    "ever capped by now" ≡ "a capped tube of that color exists now." Thus the current frozen state is
 *    a pure function of `(board, hidden, IceGrid)` — there is nothing to remember between moves, and
 *    `IceGrid` threads through the solver/metrics as one static optional `ice?` param like `funnels?`
 *    (no new search-state dimension, unlike `hidden`'s evolving concealment).
 *
 * Solvability is guaranteed by construction (the {@link ./hidden} `exposableCells` analogue): ice is
 * derived from the stored solution so that each block's trigger is capped strictly *before* the block
 * must be poured through — so replaying that solution always thaws every block in time.
 */
import { pour } from './engine';
import { isCapped, knownTopRun, revealExposed, type HiddenGrid } from './hidden';
import { mulberry32 } from './rng';
import type { Color, GameState, Move } from './types';

/**
 * A per-cell overlay parallel to a board's bottles (bottom-first): the trigger color tinting a frozen
 * cell, or `null` for an ordinary cell. Maintains a contiguous-bottom invariant — within a tube, the
 * non-null cells form an unbroken block from index 0 up to the ice line, all the same color.
 */
export type IceGrid = readonly (readonly (Color | null)[])[];

/** Fraction of ice-eligible tubes that actually start frozen (seeded). Tunable, like `HIDDEN_PROB`. */
export const ICE_PROB = 0.5;

/** An all-clear grid shaped to the board (used outside the ice chapter and for resets). */
export function noIce(state: GameState): IceGrid {
  return state.bottles.map((bottle) => bottle.map(() => null));
}

/** Whether any cell carries ice. */
export function anyIce(ice: IceGrid): boolean {
  return ice.some((col) => col.some((tint) => tint != null));
}

/**
 * The set of colors that are currently CAPPED — a tube full of that color, fully revealed, and with no
 * still-frozen cell of its own. Computed as a bounded fixpoint because thawing can cascade: capping a
 * color frees ice that lets another tube cap, completing another color… Each round can only add a
 * color, bounded by the palette, so it settles in ≤ #colors passes. The fixpoint depth IS the cascade
 * depth (an ice block deep in a chain thaws only after its predecessors).
 */
export function cappedColors(state: GameState, hidden: HiddenGrid, ice: IceGrid): Set<Color> {
  const capped = new Set<Color>();
  let changed = true;
  while (changed) {
    changed = false;
    state.bottles.forEach((bottle, b) => {
      if (bottle.length === 0) return;
      const c = bottle[0]!;
      if (capped.has(c)) return;
      if (!isCapped(bottle, state.capacity, hidden[b])) return; // full + single + revealed
      // A tube isn't finished while it still holds a frozen cell of its own (only present cells count).
      const frozenSelf = bottle.some((_, i) => {
        const tint = ice[b]?.[i];
        return tint != null && !capped.has(tint);
      });
      if (frozenSelf) return;
      capped.add(c);
      changed = true;
    });
  }
  return capped;
}

/**
 * The live frozen state: cell (b, i) is frozen iff it carries ice whose trigger color is not yet
 * capped. Shaped to the CURRENT bottles (so it indexes alongside `knownTopRun`/`isCapped`); ice on
 * cells already poured away is ignored.
 */
export function frozenCells(state: GameState, hidden: HiddenGrid, ice: IceGrid): boolean[][] {
  const capped = cappedColors(state, hidden, ice);
  return state.bottles.map((bottle, b) =>
    bottle.map((_, i) => {
      const tint = ice[b]?.[i];
      return tint != null && !capped.has(tint);
    }),
  );
}

/** Whether any cell is still frozen (a tube holding one can't be finished, so the level isn't won). */
export function anyFrozen(state: GameState, hidden: HiddenGrid, ice: IceGrid): boolean {
  return frozenCells(state, hidden, ice).some((col) => col.some(Boolean));
}

/**
 * The concealment columns the run-cap/cap helpers should consult under ice: `hidden` merged with the
 * derived frozen cells, since a frozen cell blocks the visible run and prevents capping exactly like a
 * hidden "?". Returns `hidden` unchanged when the board carries no ice, so non-ice callers are
 * unaffected. This is what lets `knownTopRun`/`isCapped` stay ice-unaware — callers pass the merged
 * column instead of the raw `hidden` one.
 */
export function blockedColumns(state: GameState, hidden: HiddenGrid, ice: IceGrid): HiddenGrid {
  if (!anyIce(ice)) return hidden;
  const frozen = frozenCells(state, hidden, ice);
  return state.bottles.map((bottle, b) => {
    const hd = hidden[b];
    const fr = frozen[b]!;
    return bottle.map((_, i) => (hd?.[i] ?? false) || fr[i]!);
  });
}

/** One way to freeze a tube: its ice line (freeze cells `0..line`) and the triggers that keep it legal. */
export interface IceLineOption {
  /** Freeze the contiguous block of cells `0..line` (inclusive). */
  line: number;
  /** Colors whose cap (via another tube) lands strictly before the ice line must be poured through. */
  triggers: Color[];
}

/**
 * For each tube, the ice lines it may legally be frozen at and the triggers that keep the stored
 * solution beatable. Derived by replaying the solution under the *real* capped-solve rules (pours
 * capped to the visible run, hidden cells revealing as they surface) and recording, in pour-action
 * time:
 *   - `dropTime[b][i]` — when bottle `b` is first poured down to height `≤ i` (the cell at `i` leaves);
 *   - cap events `(color, tube, time)` — when each tube is first capped.
 * Tube `b` may freeze at line `t` with trigger `C` iff some *other* tube caps `C` strictly before
 * `dropTime[b][t]` (the topmost frozen cell must thaw before it has to move). The other-tube exclusion
 * matters: a tube can't cap its own trigger (it would be frozen, hence not capped).
 */
export function iceEligibleLines(
  state: GameState,
  solution: Move[],
  hidden: HiddenGrid,
): IceLineOption[][] {
  const dropTime = state.bottles.map((bottle) => bottle.map((): number => Infinity));
  const capEvents: { color: Color; tube: number; time: number }[] = [];
  const cappedTube = new Set<number>();

  let cur = state;
  let hide = hidden;
  let time = 0;

  const record = () => {
    cur.bottles.forEach((bottle, b) => {
      for (let i = bottle.length; i < dropTime[b]!.length; i++) {
        if (dropTime[b]![i] === Infinity) dropTime[b]![i] = time;
      }
      if (!cappedTube.has(b) && bottle.length > 0 && isCapped(bottle, state.capacity, hide[b])) {
        cappedTube.add(b);
        capEvents.push({ color: bottle[0]!, tube: b, time });
      }
    });
  };

  record(); // initial drops/caps at time 0
  for (const m of solution) {
    let remaining = m.count;
    while (remaining > 0) {
      const cap = knownTopRun(cur.bottles[m.from]!, hide[m.from]);
      const { state: next, move } = pour(cur, m.from, m.to, cap);
      cur = next;
      hide = revealExposed(cur, hide);
      time++;
      remaining -= move.count;
      record();
    }
  }

  // earliest cap time of `color` by a tube other than `exclude` (Infinity if none).
  const earliestOtherCap = (color: Color, exclude: number): number => {
    let best = Infinity;
    for (const e of capEvents) {
      if (e.color === color && e.tube !== exclude && e.time < best) best = e.time;
    }
    return best;
  };

  const distinctColors = [...new Set(capEvents.map((e) => e.color))];
  return state.bottles.map((bottle, b) => {
    const options: IceLineOption[] = [];
    for (let line = 0; line < bottle.length; line++) {
      const deadline = dropTime[b]![line]!; // when the topmost frozen cell must move
      const triggers = distinctColors.filter((c) => earliestOtherCap(c, b) < deadline);
      if (triggers.length > 0) options.push({ line, triggers });
    }
    return options;
  });
}

/**
 * Tentatively choose which tubes start frozen and to what line/trigger: per tube, a seeded freeze
 * decision (one draw each, so eligibility doesn't shift the decision stream), and when frozen a seeded
 * line + trigger from its eligible options, filling `0..line` with that tint. Its XOR constant differs
 * from `computeHidden`/`computeFunnels` so a board's ice draws are decorrelated from its other overlays.
 *
 * This is only a CANDIDATE: per-tube eligibility is measured against the ice-FREE solution timeline, so
 * freezing several tubes at once can be inconsistent (freezing the tube that caps another's trigger
 * delays that cap). {@link buildIce} validates and prunes the candidate into a guaranteed-solvable grid.
 */
export function computeIce(
  state: GameState,
  seed: number,
  eligible: IceLineOption[][],
  prob = ICE_PROB,
): IceGrid {
  const rng = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  const grid: (Color | null)[][] = state.bottles.map((bottle) => bottle.map(() => null));
  state.bottles.forEach((_, b) => {
    const roll = rng() < prob; // one decision draw per tube, always
    const options = eligible[b]!; // ascending by `line` (deeper freeze = higher index)
    if (roll && options.length > 0) {
      // Bias toward the highest eligible line (deepest freeze): a tube frozen halfway up reads as more of
      // a puzzle than a single frozen floor segment. `1 - r²` skews the pick into the upper options while
      // still allowing the occasional shallow block for variety. (`buildIce` may later step a conflicting
      // tube's line down for solvability, keeping the freeze as high as still works.)
      const r = rng();
      const opt = options[Math.min(options.length - 1, Math.floor((1 - r * r) * options.length))]!;
      const trigger = opt.triggers[Math.floor(rng() * opt.triggers.length)]!;
      for (let i = 0; i <= opt.line; i++) grid[b]![i] = trigger;
    }
  });
  return grid;
}

/**
 * The first tube whose ice the stored solution would pour THROUGH (a still-frozen cell among the run a
 * move removes), or `null` if the solution stays legal under the ice rule. The single soundness check:
 * a valid ice grid is one this returns `null` for — replaying the solution never disturbs frozen ice.
 */
export function solutionPoursThroughIce(
  state: GameState,
  solution: Move[],
  hidden: HiddenGrid,
  ice: IceGrid,
): number | null {
  let cur = state;
  for (const m of solution) {
    const frozen = frozenCells(cur, hidden, ice);
    const src = cur.bottles[m.from]!;
    for (let i = src.length - m.count; i < src.length; i++) {
      if (frozen[m.from]![i]) return m.from;
    }
    cur = pour(cur, m.from, m.to).state;
  }
  return null;
}

/**
 * A tube whose ice makes the grid invalid, or `null` if the grid is sound. Two failure modes, both
 * fixed by unfreezing the returned tube: (1) the solution pours THROUGH still-frozen ice; or (2) the
 * solution finishes but ice REMAINS frozen — a block whose trigger never caps (e.g. a never-moving
 * cell in an unsatisfiable trigger cycle), so the board can't actually be completed.
 */
function iceViolation(
  state: GameState,
  solution: Move[],
  hidden: HiddenGrid,
  ice: IceGrid,
): number | null {
  const through = solutionPoursThroughIce(state, solution, hidden, ice);
  if (through != null) return through;
  let cur = state;
  for (const m of solution) cur = pour(cur, m.from, m.to).state;
  const stuck = frozenCells(cur, hidden, ice).findIndex((col) => col.some(Boolean));
  return stuck === -1 ? null : stuck;
}

/**
 * Build a guaranteed-solvable ice grid for a level: take {@link computeIce}'s seeded candidate, then
 * **prune** — while some tube's ice makes the grid invalid (see {@link iceViolation}), step that tube's
 * ice line DOWN one cell (remove its topmost frozen segment), only fully clearing the tube once even its
 * floor segment conflicts. This keeps each freeze as HIGH as still works (vs. discarding the whole tube),
 * preserving the deeper, more interesting blocks {@link computeIce} aims for. Removing a cell with the
 * same trigger stays individually eligible (a lower line has a later deadline), and ice only ever shrinks,
 * so it's monotone and converges. The ice chapter must always SHOW the mechanic, so if pruning empties the
 * grid we force ONE eligible tube on (seed-chosen); a lone frozen tube is always valid because the tube
 * that caps its trigger stays unfrozen. A board with no eligible tube at all stays ice-free (filtered out
 * by the bake).
 */
export function buildIce(
  state: GameState,
  solution: Move[],
  hidden: HiddenGrid,
  seed: number,
  prob = ICE_PROB,
): IceGrid {
  const eligible = iceEligibleLines(state, solution, hidden);
  const grid = computeIce(state, seed, eligible, prob).map((col) => [...col]);

  for (let bad = iceViolation(state, solution, hidden, grid); bad != null; ) {
    const col = grid[bad]!;
    const top = col.reduce((acc, t, i) => (t != null ? i : acc), -1); // topmost frozen cell
    if (top < 0) break; // defensive: an offender always has frozen ice, so this shouldn't trigger
    col[top] = null; // lower the ice line one cell, keeping the rest of the block frozen
    bad = iceViolation(state, solution, hidden, grid);
  }

  if (grid.some((col) => col.some((t) => t != null))) return grid;
  const eligibleTubes = eligible.flatMap((options, b) => (options.length > 0 ? [b] : []));
  if (eligibleTubes.length === 0) return grid; // nothing we can safely freeze
  const rng = mulberry32((seed ^ 0x85ebca6b ^ 0x5bf03635) >>> 0); // distinct stream for the fallback
  const b = eligibleTubes[Math.floor(rng() * eligibleTubes.length)]!;
  const opt = eligible[b]![Math.floor(rng() * eligible[b]!.length)]!;
  const trigger = opt.triggers[Math.floor(rng() * opt.triggers.length)]!;
  for (let i = 0; i <= opt.line; i++) grid[b]![i] = trigger;
  return grid;
}

/**
 * Remap ice tints through a color bijection — the SAME map the board is recolored with each play (see
 * `recolor.ts`). Without lockstep remapping, a recolored board would show ice tinted a color the liquid
 * no longer uses.
 */
export function recolorIce(ice: IceGrid, map: Record<string, Color>): IceGrid {
  return ice.map((col) => col.map((tint) => (tint == null ? null : map[tint] ?? tint)));
}

/**
 * Ice difficulty load (0 outside the ice chapter): the fraction of segments that start frozen. More
 * frozen volume ⇒ more of the board locked behind a completion order ⇒ harder. Size-decoupled (a
 * ratio) so it captures the chapter's pressure without just tracking board size.
 */
export function iceLoad(ice: IceGrid): number {
  let iced = 0;
  let total = 0;
  for (const col of ice) {
    for (const tint of col) {
      total++;
      if (tint != null) iced++;
    }
  }
  return total === 0 ? 0 : iced / total;
}
