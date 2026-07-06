//! The "frozen tubes" mechanic — port of `src/game/ice.ts`. The JS per-cell grid maintains a
//! contiguous-bottom single-color invariant, so here a tube's ice is just `(trigger, height)`:
//! cells `0..height` frozen, tinted `trigger`. Pruning (`build_ice`) steps `height` down — the
//! same "remove the topmost frozen cell" operation. Frozen state stays fully DERIVED (a pure
//! function of board + hidden + grid), so it adds no search-state dimension.

use crate::engine::pour;
use crate::hidden::{is_capped, known_top_run, reveal_exposed};
use crate::rng::Mulberry32;
use crate::state::{Hidden, State};
use crate::types::{Move, NO_COLOR};

pub const ICE_PROB: f64 = 0.5;

/// XOR constants (JS `computeIce` / `buildIce`'s fallback stream).
const ICE_SEED_XOR: u32 = 0x85ebca6b;
const ICE_FALLBACK_XOR: u32 = 0x5bf03635;

/// One tube's ice: trigger tint (`NO_COLOR` = no ice) and block height (cells `0..height`).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct IceTube {
    pub trigger: u8,
    pub height: u8,
}

impl IceTube {
    pub const NONE: IceTube = IceTube { trigger: NO_COLOR, height: 0 };

    #[inline]
    fn active(&self) -> bool {
        self.trigger != NO_COLOR && self.height > 0
    }
}

pub type Ice = Vec<IceTube>;

pub fn no_ice(state: &State) -> Ice {
    vec![IceTube::NONE; state.tubes.len()]
}

pub fn any_ice(ice: &Ice) -> bool {
    ice.iter().any(|t| t.active())
}

/// Colors currently CAPPED, as a bitmask over color ids — the bounded thaw-cascade fixpoint
/// of `cappedColors`. A tube isn't finished while it still holds a frozen cell of its own
/// (present cells only, i.e. indices below the current fill).
pub fn capped_colors(state: &State, hidden: &Hidden, ice: &Ice) -> u16 {
    let mut capped: u16 = 0;
    let mut changed = true;
    while changed {
        changed = false;
        for (b, t) in state.tubes.iter().enumerate() {
            if t.is_empty() {
                continue;
            }
            let c = t.cell(0);
            if capped & (1 << c) != 0 {
                continue;
            }
            if !is_capped(t, state.capacity, hidden[b]) {
                continue;
            }
            let it = ice[b];
            let frozen_self =
                it.trigger != NO_COLOR && (it.height as usize).min(t.len()) > 0 && capped & (1 << it.trigger) == 0;
            if frozen_self {
                continue;
            }
            capped |= 1 << c;
            changed = true;
        }
    }
    capped
}

/// Live frozen cells as per-tube bitmasks, shaped to the CURRENT fills (ice on cells already
/// poured away is ignored) — the mask analogue of `frozenCells`.
pub fn frozen_masks(state: &State, hidden: &Hidden, ice: &Ice) -> Vec<u16> {
    let capped = capped_colors(state, hidden, ice);
    state
        .tubes
        .iter()
        .enumerate()
        .map(|(b, t)| {
            let it = ice[b];
            if it.trigger == NO_COLOR || capped & (1 << it.trigger) != 0 {
                return 0;
            }
            let h = (it.height as usize).min(t.len());
            ((1u32 << h) - 1) as u16
        })
        .collect()
}

pub fn any_frozen(state: &State, hidden: &Hidden, ice: &Ice) -> bool {
    frozen_masks(state, hidden, ice).iter().any(|&m| m != 0)
}

/// One legal way to freeze a tube: an ice line and the triggers that keep it beatable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IceLineOption {
    /// Freeze cells `0..=line`.
    pub line: usize,
    /// Trigger colors capped (by another tube) strictly before the line must be poured through.
    pub triggers: Vec<u8>,
}

/// Per tube, the eligible ice lines — port of `iceEligibleLines`: replay the solution under
/// the real capped-solve rules, recording per-cell drop times and per-tube first-cap events,
/// then admit `(line, trigger)` iff some OTHER tube caps the trigger strictly before the
/// line's drop time. Trigger lists preserve first-cap-event order (the RNG pick in
/// `compute_ice` indexes into them, so order is load-bearing).
pub fn ice_eligible_lines(state: &State, solution: &[Move], hidden: &Hidden) -> Vec<Vec<IceLineOption>> {
    const NEVER: u32 = u32::MAX;
    let initial_len: Vec<usize> = state.tubes.iter().map(|t| t.len()).collect();
    let mut drop_time: Vec<Vec<u32>> = initial_len.iter().map(|&l| vec![NEVER; l]).collect();
    let mut cap_events: Vec<(u8, usize, u32)> = Vec::new(); // (color, tube, time)
    let mut capped_tube = vec![false; state.tubes.len()];

    let mut cur = state.clone();
    let mut hide = hidden.clone();
    let mut time: u32 = 0;

    let mut record = |cur: &State, hide: &Hidden, time: u32| {
        for (b, t) in cur.tubes.iter().enumerate() {
            for i in t.len()..drop_time[b].len() {
                if drop_time[b][i] == NEVER {
                    drop_time[b][i] = time;
                }
            }
            if !capped_tube[b] && !t.is_empty() && is_capped(t, cur.capacity, hide[b]) {
                capped_tube[b] = true;
                cap_events.push((t.cell(0), b, time));
            }
        }
    };

    record(&cur, &hide, time); // initial drops/caps at time 0
    for m in solution {
        let mut remaining = m.count as usize;
        while remaining > 0 {
            let cap = known_top_run(&cur.tubes[m.from as usize], hide[m.from as usize]);
            let (next, mv) = pour(&cur, m.from as usize, m.to as usize, cap);
            cur = next;
            hide = reveal_exposed(&cur, &hide);
            time += 1;
            remaining -= mv.count as usize;
            record(&cur, &hide, time);
        }
    }

    let earliest_other_cap = |color: u8, exclude: usize| -> u32 {
        let mut best = NEVER;
        for &(c, tube, t) in &cap_events {
            if c == color && tube != exclude && t < best {
                best = t;
            }
        }
        best
    };

    // Distinct cap colors in first-seen order (JS `[...new Set(...)]` preserves insertion).
    let mut distinct: Vec<u8> = Vec::new();
    for &(c, _, _) in &cap_events {
        if !distinct.contains(&c) {
            distinct.push(c);
        }
    }

    (0..state.tubes.len())
        .map(|b| {
            let mut options = Vec::new();
            for (line, &deadline) in drop_time[b].iter().enumerate() {
                let triggers: Vec<u8> =
                    distinct.iter().copied().filter(|&c| earliest_other_cap(c, b) < deadline).collect();
                if !triggers.is_empty() {
                    options.push(IceLineOption { line, triggers });
                }
            }
            options
        })
        .collect()
}

/// Seeded candidate freeze — port of `computeIce`, draw-for-draw: one decision draw per tube,
/// then (when freezing) the `1 - r²` deep-line bias draw and the trigger draw.
pub fn compute_ice(state: &State, seed: u32, eligible: &[Vec<IceLineOption>], prob: f64) -> Ice {
    let mut rng = Mulberry32::new(seed ^ ICE_SEED_XOR);
    let mut grid = no_ice(state);
    for b in 0..state.tubes.len() {
        let roll = rng.next_f64() < prob;
        let options = &eligible[b];
        if roll && !options.is_empty() {
            let r = rng.next_f64();
            let idx = (options.len() - 1).min(((1.0 - r * r) * options.len() as f64).floor() as usize);
            let opt = &options[idx];
            let trigger = opt.triggers[(rng.next_f64() * opt.triggers.len() as f64).floor() as usize];
            grid[b] = IceTube { trigger, height: (opt.line + 1) as u8 };
        }
    }
    grid
}

/// First tube whose still-frozen ice the stored solution pours THROUGH, or `None` if legal.
pub fn solution_pours_through_ice(
    state: &State,
    solution: &[Move],
    hidden: &Hidden,
    ice: &Ice,
) -> Option<usize> {
    let mut cur = state.clone();
    for m in solution {
        let frozen = frozen_masks(&cur, hidden, ice);
        let from = m.from as usize;
        let src_len = cur.tubes[from].len();
        for i in (src_len - m.count as usize)..src_len {
            if frozen[from] & (1 << i) != 0 {
                return Some(from);
            }
        }
        cur = pour(&cur, from, m.to as usize, usize::MAX).0;
    }
    None
}

/// A tube whose ice makes the grid invalid (`iceViolation`): the solution pours through
/// still-frozen ice, or finishes with ice still frozen (trigger never caps).
fn ice_violation(state: &State, solution: &[Move], hidden: &Hidden, ice: &Ice) -> Option<usize> {
    if let Some(b) = solution_pours_through_ice(state, solution, hidden, ice) {
        return Some(b);
    }
    let mut cur = state.clone();
    for m in solution {
        cur = pour(&cur, m.from as usize, m.to as usize, usize::MAX).0;
    }
    frozen_masks(&cur, hidden, ice).iter().position(|&m| m != 0)
}

/// Guaranteed-solvable ice grid — port of `buildIce`: seeded candidate, prune by stepping the
/// offending tube's line down one cell at a time, then the force-one-eligible fallback on a
/// distinct RNG stream if pruning emptied the grid.
pub fn build_ice(state: &State, solution: &[Move], hidden: &Hidden, seed: u32, prob: f64) -> Ice {
    let eligible = ice_eligible_lines(state, solution, hidden);
    let mut grid = compute_ice(state, seed, &eligible, prob);

    while let Some(bad) = ice_violation(state, solution, hidden, &grid) {
        if grid[bad].height == 0 {
            break; // defensive: an offender always has frozen ice (mirrors the JS guard)
        }
        grid[bad].height -= 1; // lower the ice line one cell
        if grid[bad].height == 0 {
            grid[bad] = IceTube::NONE;
        }
    }

    if any_ice(&grid) {
        return grid;
    }
    let eligible_tubes: Vec<usize> =
        eligible.iter().enumerate().filter(|(_, o)| !o.is_empty()).map(|(b, _)| b).collect();
    if eligible_tubes.is_empty() {
        return grid; // nothing we can safely freeze
    }
    let mut rng = Mulberry32::new(seed ^ ICE_SEED_XOR ^ ICE_FALLBACK_XOR);
    let b = eligible_tubes[(rng.next_f64() * eligible_tubes.len() as f64).floor() as usize];
    let opts = &eligible[b];
    let opt = &opts[(rng.next_f64() * opts.len() as f64).floor() as usize];
    let trigger = opt.triggers[(rng.next_f64() * opt.triggers.len() as f64).floor() as usize];
    grid[b] = IceTube { trigger, height: (opt.line + 1) as u8 };
    grid
}

/// Ice difficulty load: fraction of (initial) segments that start frozen (`iceLoad` — the JS
/// grid is shaped to the initial bottles, so `total` is the sum of initial fills).
pub fn ice_load(ice: &Ice, state: &State) -> f64 {
    let total: usize = state.tubes.iter().map(|t| t.len()).sum();
    if total == 0 {
        return 0.0;
    }
    let iced: usize = ice.iter().map(|t| if t.trigger != NO_COLOR { t.height as usize } else { 0 }).sum();
    iced as f64 / total as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Tube;

    #[test]
    fn capped_colors_cascade() {
        // Tube 0: capped color 1. Tube 1: full of color 2 but frozen on trigger 1 → thaws
        // once 1 caps, then 2 caps too (one extra fixpoint round).
        let s = State {
            tubes: vec![Tube::from_cells(&[1, 1, 1, 1]), Tube::from_cells(&[2, 2, 2, 2])],
            capacity: 4,
        };
        let hidden = vec![0u16, 0];
        let ice = vec![IceTube::NONE, IceTube { trigger: 1, height: 2 }];
        let capped = capped_colors(&s, &hidden, &ice);
        assert_eq!(capped, (1 << 1) | (1 << 2));
        assert!(!any_frozen(&s, &hidden, &ice));
    }

    #[test]
    fn frozen_blocks_until_trigger_caps() {
        let s = State {
            tubes: vec![Tube::from_cells(&[1, 1, 1]), Tube::from_cells(&[2, 2, 2, 2])],
            capacity: 4,
        };
        let hidden = vec![0u16, 0];
        let ice = vec![IceTube::NONE, IceTube { trigger: 1, height: 2 }];
        // Color 1 not capped (tube 0 not full) ⇒ tube 1's bottom two cells frozen.
        assert_eq!(frozen_masks(&s, &hidden, &ice), vec![0, 0b0011]);
    }
}
