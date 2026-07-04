//! Internal packed game state — the performance core of the port. JS keys search states as
//! sorted strings (`stateKey`); here a tube is one `u64` (4-bit color nibbles + length), a
//! concealment column is one `u16` bitmask, and the canonical key is a sorted `Vec<u128>` of
//! per-tube `(packed, hidden)` words. The key's exact form differs from JS's string, but its
//! *equivalence classes* are identical (order-independent multiset of (cells, concealment)
//! columns), which is all any caller compares.
//!
//! Bounds come from `progression.ts`: capacity ≤ 10, bottles ≤ 15, colors ≤ 12 — so cells fit
//! 4-bit nibbles (ids 0–11) and a tube fits `[u8; 10]` inline with no heap.

use crate::types::{Board, NO_COLOR};

/// Max tube height (progression caps capacity at 10).
pub const MAX_CAP: usize = 10;

/// One tube: inline cells (bottom-first) + fill height. `Copy`, no allocation.
#[derive(Clone, Copy, Debug)]
pub struct Tube {
    cells: [u8; MAX_CAP],
    len: u8,
}

/// Equality over the VISIBLE cells only — `pop_n` leaves stale bytes above `len`, which must
/// not count (two tubes with equal contents are equal regardless of pour history).
impl PartialEq for Tube {
    fn eq(&self, other: &Self) -> bool {
        self.len == other.len && self.cells() == other.cells()
    }
}
impl Eq for Tube {}

impl Tube {
    pub const EMPTY: Tube = Tube { cells: [0; MAX_CAP], len: 0 };

    pub fn from_cells(cells: &[u8]) -> Tube {
        debug_assert!(cells.len() <= MAX_CAP);
        let mut t = Tube::EMPTY;
        t.cells[..cells.len()].copy_from_slice(cells);
        t.len = cells.len() as u8;
        t
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len as usize
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Cell at `i` (bottom-first). Caller guarantees `i < len()`.
    #[inline]
    pub fn cell(&self, i: usize) -> u8 {
        self.cells[i]
    }

    #[inline]
    pub fn cells(&self) -> &[u8] {
        &self.cells[..self.len as usize]
    }

    #[inline]
    pub fn top(&self) -> Option<u8> {
        if self.len == 0 { None } else { Some(self.cells[self.len as usize - 1]) }
    }

    #[inline]
    pub fn pop_n(&mut self, n: usize) {
        debug_assert!(n <= self.len());
        self.len -= n as u8;
    }

    #[inline]
    pub fn push_n(&mut self, color: u8, n: usize) {
        debug_assert!(self.len() + n <= MAX_CAP);
        for _ in 0..n {
            self.cells[self.len as usize] = color;
            self.len += 1;
        }
    }

    /// Whole tube one uniform color and non-empty.
    pub fn is_uniform(&self) -> bool {
        self.len > 0 && self.cells().iter().all(|&c| c == self.cells[0])
    }

    /// Injective packing: cells as 4-bit nibbles (color ids are < 12 < 15) + length in the top
    /// nibble region. Two tubes pack equal iff their visible contents are equal.
    pub fn packed(&self) -> u64 {
        let mut acc = (self.len as u64) << 60;
        for (i, &c) in self.cells().iter().enumerate() {
            debug_assert!(c < 15, "color id {c} does not fit a nibble");
            acc |= (c as u64) << (4 * i);
        }
        acc
    }
}

/// The full board. Mirrors the TS `GameState`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct State {
    pub tubes: Vec<Tube>,
    pub capacity: u8,
}

/// Per-tube concealment bitmask (bit `i` = cell `i` starts concealed). Concealed cells never
/// move while concealed (they must surface to be poured), so bit positions stay valid as the
/// tube evolves — same argument as the JS grid keeping its initial dimensions.
pub type Hidden = Vec<u16>;

/// Order-independent canonical key for a (board, concealment) state — the packed analogue of
/// the JS `stateKey`. Sorted per-tube `(packed cells, hidden mask)` words.
pub type Key = Vec<u128>;

pub fn state_key(state: &State, hidden: Option<&Hidden>) -> Key {
    let mut parts: Vec<u128> = state
        .tubes
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let h = hidden.map_or(0u16, |hh| hh[i]);
            (t.packed() as u128) | ((h as u128) << 64)
        })
        .collect();
    parts.sort_unstable();
    parts
}

/// All-visible concealment for a board (chapter-0 / reset shape).
pub fn empty_hidden(state: &State) -> Hidden {
    vec![0; state.tubes.len()]
}

impl State {
    /// From the byte-boundary [`Board`] (flat cells, `NO_COLOR` above the fill line).
    pub fn from_board(board: &Board) -> State {
        let cap = board.capacity as usize;
        let tubes = (0..board.bottles)
            .map(|b| {
                let base = b as usize * cap;
                let col = &board.cells[base..base + cap];
                let fill = col.iter().take_while(|&&c| c != NO_COLOR).count();
                Tube::from_cells(&col[..fill])
            })
            .collect();
        State { tubes, capacity: board.capacity }
    }

    pub fn to_board(&self) -> Board {
        let mut board = Board::new(self.tubes.len() as u8, self.capacity);
        for (b, t) in self.tubes.iter().enumerate() {
            for (i, &c) in t.cells().iter().enumerate() {
                let idx = board.cell_index(b as u8, i as u8);
                board.cells[idx] = c;
            }
        }
        board
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_is_order_independent_and_injective() {
        let a = State {
            tubes: vec![Tube::from_cells(&[1, 2]), Tube::from_cells(&[3]), Tube::EMPTY],
            capacity: 4,
        };
        let b = State {
            tubes: vec![Tube::EMPTY, Tube::from_cells(&[3]), Tube::from_cells(&[1, 2])],
            capacity: 4,
        };
        assert_eq!(state_key(&a, None), state_key(&b, None));

        let c = State {
            tubes: vec![Tube::from_cells(&[2, 1]), Tube::from_cells(&[3]), Tube::EMPTY],
            capacity: 4,
        };
        assert_ne!(state_key(&a, None), state_key(&c, None));

        // Same board, different concealment ⇒ different key.
        let h0 = vec![0u16, 0, 0];
        let h1 = vec![1u16, 0, 0];
        assert_ne!(state_key(&a, Some(&h0)), state_key(&a, Some(&h1)));
        // No concealment and an all-clear grid collapse to the same key.
        assert_eq!(state_key(&a, None), state_key(&a, Some(&h0)));
    }

    #[test]
    fn board_round_trip() {
        let s = State {
            tubes: vec![Tube::from_cells(&[0, 1, 1]), Tube::EMPTY, Tube::from_cells(&[2])],
            capacity: 4,
        };
        assert_eq!(State::from_board(&s.to_board()), s);
    }
}
