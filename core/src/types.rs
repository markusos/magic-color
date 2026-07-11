//! Byte-boundary types shared by both targets (PLAN.md F0).
//!
//! Everything that crosses a boundary — native bake → JSON, wasm → JS worker messages — is
//! flat bytes with `u8` color ids, so the wasm side needs no serde and the packed solver state
//! (F1) derives directly from these. Mapping to the TS side (`src/game/types.ts` + overlays):
//!
//! - `Color` (branded palette-id string) ⇔ `u8` index into [`PALETTE`]; [`NO_COLOR`] = absent.
//! - `GameState { bottles: Color[][], capacity }` ⇔ [`Board`] (bottle-major, bottom-first,
//!   `NO_COLOR` above the fill line).
//! - `HiddenGrid` (`boolean[][]`) ⇔ per-cell `0/1` bytes, bottle-major (carried as search
//!   state, like the JS solver does).
//! - `FunnelGrid` (`(Color | null)[]`, per tube) ⇔ per-bottle color bytes.
//! - `IceGrid` (`(Color | null)[][]`, per cell) ⇔ per-cell color bytes, bottle-major.
//!
//! Palette order is load-bearing: it defines the id ⇔ string mapping on both sides and is one
//! of the shared constants the G5 gate asserts across languages.

/// Palette ids in the exact order of `PALETTE` in `src/game/generator.ts`. A color's byte id
/// is its index here; boundary code converts id ⇔ string only at the edges.
pub const PALETTE: [&str; 12] = [
    "ruby",
    "amethyst",
    "sapphire",
    "emerald",
    "amber",
    "rose",
    "teal",
    "violet",
    "lime",
    "tangerine",
    "cobalt",
    "magenta",
];

/// Sentinel byte for "no color": an empty board cell, an unfunneled tube, an unfrozen cell.
pub const NO_COLOR: u8 = 255;

/// Standard water-sort capacity (`DEFAULT_CAPACITY` in `generator.ts`).
pub const DEFAULT_CAPACITY: u8 = 4;

/// Palette id for a color byte — the id↔index mapping, one home for the whole crate (bins that
/// (de)serialize the JSON board format go through here rather than re-deriving it).
pub fn color_name(id: u8) -> &'static str {
    PALETTE[id as usize]
}

/// Color byte for a palette id, or `None` if it isn't a palette color. The JS adapter mirrors
/// this over the wasm boundary (palette ORDER is the shared contract — see the module docs).
pub fn color_index(name: &str) -> Option<u8> {
    PALETTE.iter().position(|p| *p == name).map(|i| i as u8)
}

/// A single pour, mirroring the TS `Move`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Move {
    pub from: u8,
    pub to: u8,
    /// Segments transferred.
    pub count: u8,
    /// Color poured (top color of `from`).
    pub color: u8,
}

/// The full board as flat bytes: `bottles × capacity` cells, bottle-major, bottom-first within
/// a bottle, `NO_COLOR` above each fill line. This is the wire format; the solver's packed
/// state (F1) is derived from it, not sent over the boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Board {
    pub bottles: u8,
    pub capacity: u8,
    pub cells: Vec<u8>,
}

impl Board {
    pub fn new(bottles: u8, capacity: u8) -> Self {
        Self {
            bottles,
            capacity,
            cells: vec![NO_COLOR; bottles as usize * capacity as usize],
        }
    }

    /// Flat index of `(bottle, slot)`; slot 0 is the bottom.
    #[inline]
    pub fn cell_index(&self, bottle: u8, slot: u8) -> usize {
        bottle as usize * self.capacity as usize + slot as usize
    }

    #[inline]
    pub fn cell(&self, bottle: u8, slot: u8) -> u8 {
        self.cells[self.cell_index(bottle, slot)]
    }

    /// Number of filled segments in `bottle` (cells are contiguous from the bottom).
    pub fn fill(&self, bottle: u8) -> u8 {
        let base = bottle as usize * self.capacity as usize;
        let column = &self.cells[base..base + self.capacity as usize];
        column.iter().take_while(|&&c| c != NO_COLOR).count() as u8
    }
}

/// The static per-board mechanic overlays (TS `Overlays` bundle + the per-node `HiddenGrid`).
/// `None` ⇒ the mechanic is absent and behavior is byte-identical to the un-mechanic'd game —
/// the same "absent field" contract the TS bundle guarantees.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Overlays {
    /// Per-bottle funnel lock color (`len == bottles`), `NO_COLOR` = unfunneled.
    pub funnels: Option<Vec<u8>>,
    /// Per-cell ice trigger color (`len == bottles × capacity`, bottle-major), `NO_COLOR` = none.
    pub ice: Option<Vec<u8>>,
    /// Per-cell hidden flags (`len == bottles × capacity`, bottle-major), `0/1`. Unlike the two
    /// static grids above this evolves during search (reveals), exactly as in the JS solver.
    pub hidden: Option<Vec<u8>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_indexing_is_bottle_major_bottom_first() {
        let mut b = Board::new(3, 4);
        let (bottom, above) = (b.cell_index(1, 0), b.cell_index(1, 1));
        b.cells[bottom] = 5;
        b.cells[above] = 7;
        assert_eq!(b.cell(1, 0), 5);
        assert_eq!(b.cell(1, 1), 7);
        assert_eq!(b.cell(0, 0), NO_COLOR);
        assert_eq!(b.fill(1), 2);
        assert_eq!(b.fill(0), 0);
    }

    #[test]
    fn palette_has_twelve_unique_ids() {
        let mut ids: Vec<&str> = PALETTE.to_vec();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 12);
    }
}
