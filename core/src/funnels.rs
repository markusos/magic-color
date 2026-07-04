//! The "color-locked funnels" mechanic — port of `src/game/funnels.ts`. Per-tube lock color,
//! `NO_COLOR` = unlocked. Pure move filter (no search-state dimension), same as JS.

use crate::rng::Mulberry32;
use crate::state::State;
use crate::types::{Move, NO_COLOR};

pub const FUNNEL_PROB: f64 = 0.5;

/// XOR constant decorrelating the funnel stream (JS `computeFunnels`).
const FUNNEL_SEED_XOR: u32 = 0x6d2b79f5;

/// Per-tube lock color; `NO_COLOR` = ordinary tube.
pub type Funnels = Vec<u8>;

pub fn any_funnel(funnels: &Funnels) -> bool {
    funnels.iter().any(|&t| t != NO_COLOR)
}

/// Whether tube `to` accepts a pour of `color` — the single rule funnels add.
#[inline]
pub fn accepts(funnels: Option<&Funnels>, to: usize, color: u8) -> bool {
    match funnels {
        None => true,
        Some(f) => f[to] == NO_COLOR || f[to] == color,
    }
}

/// The color each tube is ELIGIBLE to be locked to: its solution inflow color if monochrome,
/// else `NO_COLOR`. Mirrors `funnelEligibleTubes`.
pub fn eligible_tubes(state: &State, solution: &[Move]) -> Vec<u8> {
    let n = state.tubes.len();
    let mut inflow = vec![NO_COLOR; n];
    let mut conflicted = vec![false; n];
    for m in solution {
        let to = m.to as usize;
        if conflicted[to] {
            continue;
        }
        if inflow[to] == NO_COLOR {
            inflow[to] = m.color;
        } else if inflow[to] != m.color {
            conflicted[to] = true;
            inflow[to] = NO_COLOR;
        }
    }
    inflow
}

/// Choose which tubes start funneled: one draw per tube (stream stays aligned), then the
/// force-one-eligible fallback if the pass locked nothing. Mirrors `computeFunnels` exactly,
/// including draw order and the fallback's extra draw.
pub fn compute_funnels(state: &State, seed: u32, eligible: &[u8], prob: f64) -> Funnels {
    let mut rng = Mulberry32::new(seed ^ FUNNEL_SEED_XOR);
    let mut grid: Funnels = (0..state.tubes.len())
        .map(|t| {
            let lock = rng.next_f64() < prob;
            if lock { eligible[t] } else { NO_COLOR }
        })
        .collect();
    if grid.iter().any(|&t| t != NO_COLOR) {
        return grid;
    }
    let eligible_idx: Vec<usize> =
        eligible.iter().enumerate().filter(|(_, &c)| c != NO_COLOR).map(|(t, _)| t).collect();
    if eligible_idx.is_empty() {
        return grid; // nothing we can safely lock
    }
    let pick = eligible_idx[(rng.next_f64() * eligible_idx.len() as f64).floor() as usize];
    grid[pick] = eligible[pick];
    grid
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Tube;

    #[test]
    fn eligibility_requires_monochrome_inflow() {
        let s = State {
            tubes: vec![Tube::EMPTY, Tube::EMPTY, Tube::EMPTY],
            capacity: 4,
        };
        let solution = [
            Move { from: 2, to: 0, count: 1, color: 3 },
            Move { from: 2, to: 0, count: 1, color: 3 },
            Move { from: 0, to: 1, count: 1, color: 3 },
            Move { from: 2, to: 1, count: 1, color: 5 }, // mixed inflow for tube 1
        ];
        assert_eq!(eligible_tubes(&s, &solution), vec![3, NO_COLOR, NO_COLOR]);
    }
}
