//! Pure rules engine — the line-for-line port of `src/game/engine.ts`. Same immutable
//! semantics (a pour returns a new state); enumeration order (from asc × to asc) is preserved
//! exactly because the DFS solver's byte-reproducible solutions depend on it.

use crate::state::{State, Tube};
use crate::types::Move;

/// Contiguous same-color run at the top of a tube.
pub fn top_run_length(t: &Tube) -> usize {
    let n = t.len();
    if n == 0 {
        return 0;
    }
    let color = t.cell(n - 1);
    let mut run = 1;
    for i in (0..n - 1).rev() {
        if t.cell(i) == color {
            run += 1;
        } else {
            break;
        }
    }
    run
}

#[inline]
pub fn free_space(t: &Tube, capacity: u8) -> usize {
    capacity as usize - t.len()
}

/// Empty, or full and a single solid color.
pub fn is_complete(t: &Tube, capacity: u8) -> bool {
    if t.is_empty() {
        return true;
    }
    if t.len() != capacity as usize {
        return false;
    }
    t.is_uniform()
}

pub fn can_pour(state: &State, from: usize, to: usize) -> bool {
    if from == to {
        return false;
    }
    let (Some(src), Some(dst)) = (state.tubes.get(from), state.tubes.get(to)) else {
        return false;
    };
    if src.is_empty() {
        return false;
    }
    if free_space(dst, state.capacity) == 0 {
        return false;
    }
    match dst.top() {
        None => true,
        top => top == src.top(),
    }
}

/// Segments a `from -> to` pour would move; 0 if illegal.
pub fn pour_amount(state: &State, from: usize, to: usize) -> usize {
    if !can_pour(state, from, to) {
        return 0;
    }
    top_run_length(&state.tubes[from]).min(free_space(&state.tubes[to], state.capacity))
}

/// Apply a pour capped at `max_count` segments, returning the new state and executed move.
/// Panics if illegal — callers gate with `can_pour`, exactly like the JS contract (`pour`
/// throws). `usize::MAX` = uncapped (the JS `Infinity` default).
pub fn pour(state: &State, from: usize, to: usize, max_count: usize) -> (State, Move) {
    let count = pour_amount(state, from, to).min(max_count);
    assert!(count > 0, "illegal pour from {from} to {to}");
    let color = state.tubes[from].top().unwrap();

    let mut next = state.clone();
    next.tubes[from].pop_n(count);
    next.tubes[to].push_n(color, count);

    (next, Move { from: from as u8, to: to as u8, count: count as u8, color })
}

/// Won when every tube is complete (empty or a single full color).
pub fn is_won(state: &State) -> bool {
    state.tubes.iter().all(|t| is_complete(t, state.capacity))
}

/// Every legal pour, in the canonical (from asc, to asc) order the solver's determinism
/// depends on.
pub fn legal_moves(state: &State) -> Vec<(u8, u8)> {
    let n = state.tubes.len();
    let mut moves = Vec::new();
    for from in 0..n {
        for to in 0..n {
            if can_pour(state, from, to) {
                moves.push((from as u8, to as u8));
            }
        }
    }
    moves
}

/// Not won and no legal move remains.
pub fn is_deadlocked(state: &State) -> bool {
    !is_won(state) && legal_moves(state).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(tubes: Vec<&[u8]>, capacity: u8) -> State {
        State { tubes: tubes.into_iter().map(Tube::from_cells).collect(), capacity }
    }

    #[test]
    fn pour_moves_the_top_run_up_to_free_space() {
        let s = state(vec![&[0, 1, 1], &[1], &[]], 4);
        assert_eq!(pour_amount(&s, 0, 1), 2);
        let (next, mv) = pour(&s, 0, 1, usize::MAX);
        assert_eq!(mv, Move { from: 0, to: 1, count: 2, color: 1 });
        assert_eq!(next.tubes[0].cells(), &[0]);
        assert_eq!(next.tubes[1].cells(), &[1, 1, 1]);
    }

    #[test]
    fn capped_pour_respects_max_count() {
        let s = state(vec![&[1, 1, 1], &[]], 4);
        let (next, mv) = pour(&s, 0, 1, 1);
        assert_eq!(mv.count, 1);
        assert_eq!(next.tubes[0].cells(), &[1, 1]);
    }

    #[test]
    fn win_and_deadlock() {
        assert!(is_won(&state(vec![&[2, 2, 2, 2], &[]], 4)));
        // Full mixed tubes, no free space: deadlocked.
        let s = state(vec![&[0, 1, 0, 1], &[1, 0, 1, 0]], 4);
        assert!(is_deadlocked(&s));
    }
}
