//! The "hidden colors" mechanic — port of `src/game/hidden.ts` with the boolean grid replaced
//! by per-tube `u16` bitmasks. Semantics (including RNG draw order: one draw per initial cell,
//! tubes in order, bottom-first) are preserved exactly; the bake's byte-reproducibility rests
//! on that draw alignment.

use crate::engine::{is_complete, pour};
use crate::rng::Mulberry32;
use crate::state::{Hidden, State, Tube};
use crate::types::Move;

pub const HIDDEN_PROB: f64 = 0.65;

/// XOR constant decorrelating the hidden stream from the level seed (JS `computeHidden`).
const HIDDEN_SEED_XOR: u32 = 0x9e3779b9;

/// Concealable bottom layers for a capacity: `min(cap - 1, max(3, round(cap * 0.6)))`.
fn concealable_layers(capacity: u8) -> usize {
    let scaled = crate::jsnum::js_round(capacity as f64 * 0.6) as usize;
    (capacity as usize - 1).min(scaled.max(3))
}

pub fn any_hidden(hidden: &Hidden) -> bool {
    hidden.iter().any(|&m| m != 0)
}

/// Capped (finished): full, single-color, and no blocked cell. `blocked` is the tube's
/// concealment mask, optionally with frozen cells folded in (the searches do this, mirroring
/// how JS passes a merged boolean column).
pub fn is_capped(t: &Tube, capacity: u8, blocked: u16) -> bool {
    if t.len() != capacity as usize {
        return false;
    }
    is_complete(t, capacity) && blocked == 0
}

/// The most segments a player may pour from a tube: the contiguous same-color run at the top,
/// stopped by any blocked (concealed/frozen) cell.
pub fn known_top_run(t: &Tube, blocked: u16) -> usize {
    let n = t.len();
    if n == 0 {
        return 0;
    }
    let color = t.cell(n - 1);
    let mut run = 0;
    for i in (0..n).rev() {
        if blocked & (1 << i) != 0 {
            break;
        }
        if t.cell(i) != color {
            break;
        }
        run += 1;
    }
    run
}

/// Reveal any concealed cell that is now the top of its tube (permanently).
pub fn reveal_exposed(state: &State, hidden: &Hidden) -> Hidden {
    let mut next = hidden.clone();
    for (b, t) in state.tubes.iter().enumerate() {
        if !t.is_empty() {
            next[b] &= !(1 << (t.len() - 1));
        }
    }
    next
}

/// Which initial cells the solution surfaces: cell (b, i) is exposable iff tube b's height
/// drops to `<= i` at some point during a full-pour replay. Returned as per-tube bitmasks.
pub fn exposable_cells(state: &State, solution: &[Move]) -> Vec<u16> {
    let mut min_height: Vec<usize> = state.tubes.iter().map(|t| t.len()).collect();
    let mut cur = state.clone();
    for m in solution {
        cur = pour(&cur, m.from as usize, m.to as usize, usize::MAX).0;
        for (b, t) in cur.tubes.iter().enumerate() {
            if t.len() < min_height[b] {
                min_height[b] = t.len();
            }
        }
    }
    state
        .tubes
        .iter()
        .enumerate()
        .map(|(b, t)| {
            let mut mask = 0u16;
            for i in 0..t.len() {
                if min_height[b] <= i {
                    mask |= 1 << i;
                }
            }
            mask
        })
        .collect()
}

/// Choose which cells start concealed. One RNG draw per initial cell (tubes in order,
/// bottom-first) regardless of eligibility, so the stream stays aligned — exactly the JS
/// contract.
pub fn compute_hidden(state: &State, seed: u32, exposable: &[u16], prob: f64) -> Hidden {
    let mut rng = Mulberry32::new(seed ^ HIDDEN_SEED_XOR);
    let layers = concealable_layers(state.capacity);
    state
        .tubes
        .iter()
        .enumerate()
        .map(|(b, t)| {
            let mut mask = 0u16;
            for i in 0..t.len() {
                let conceal = rng.next_f64() < prob;
                let is_top = i == t.len() - 1;
                let eligible = i < layers && !is_top && (exposable[b] & (1 << i)) != 0;
                if eligible && conceal {
                    mask |= 1 << i;
                }
            }
            mask
        })
        .collect()
}

/// Pour ACTIONS to play `solution` under the real interaction rules (pours capped to the
/// visible run, concealed cells revealing as they surface).
pub fn capped_solve_moves(state: &State, solution: &[Move], hidden0: &Hidden) -> usize {
    let mut cur = state.clone();
    let mut hidden = hidden0.clone();
    let mut pours = 0;
    for m in solution {
        let mut remaining = m.count as usize;
        while remaining > 0 {
            let cap = known_top_run(&cur.tubes[m.from as usize], hidden[m.from as usize]);
            let (next, mv) = pour(&cur, m.from as usize, m.to as usize, cap);
            cur = next;
            hidden = reveal_exposed(&cur, &hidden);
            pours += 1;
            remaining -= mv.count as usize;
        }
    }
    pours
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Tube;

    #[test]
    fn concealable_layers_match_js_rounding() {
        // capacity → min(cap-1, max(3, round(cap*0.6)))
        assert_eq!(concealable_layers(4), 3);
        assert_eq!(concealable_layers(6), 4);
        assert_eq!(concealable_layers(8), 5);
        assert_eq!(concealable_layers(10), 6);
    }

    #[test]
    fn known_top_run_stops_at_blocked_cells() {
        let t = Tube::from_cells(&[2, 1, 1, 1]);
        assert_eq!(known_top_run(&t, 0), 3);
        assert_eq!(known_top_run(&t, 0b0010), 2); // concealed cell at index 1 ends the run
        assert_eq!(known_top_run(&t, 0b1000), 0); // top itself blocked (frozen)
    }

    #[test]
    fn reveal_clears_only_the_top_bit() {
        let s = State { tubes: vec![Tube::from_cells(&[1, 2])], capacity: 4 };
        let revealed = reveal_exposed(&s, &vec![0b0011]);
        assert_eq!(revealed, vec![0b0001]);
    }
}
