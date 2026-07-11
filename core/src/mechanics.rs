//! Overlay-build orchestration — the bake-side slice of `src/game/mechanics.ts`. The JS
//! registry's job is dispatch, not computation; here the fixed three-mechanic order is simply
//! written out (hidden → funnel → ice, ice reading the chosen hidden grid — the same
//! MECHANIC_ORDER contract). The interaction/serialize halves of the registry stay JS-side
//! until F6.

use crate::funnels::{any_funnel, compute_funnels, eligible_tubes, Funnels};
use crate::hidden::{compute_hidden, exposable_cells};
use crate::ice::{any_ice, build_ice, no_ice, Ice};
use crate::progression::{Mechanic, MechanicDensity};
use crate::state::{empty_hidden, Hidden, State};
use crate::types::{Move, NO_COLOR};

/// The full per-board overlay set (JS `OverlaySet`).
#[derive(Clone, Debug, PartialEq)]
pub struct OverlaySet {
    pub hidden: Hidden,
    pub funnels: Funnels,
    pub ice: Ice,
}

/// All-clear overlays shaped to a board.
pub fn empty_overlays(state: &State) -> OverlaySet {
    OverlaySet {
        hidden: empty_hidden(state),
        funnels: vec![NO_COLOR; state.tubes.len()],
        ice: no_ice(state),
    }
}

/// Build a board's initial overlays from its solution — port of `buildOverlays`: each active
/// mechanic in registry order, per-mechanic density as its `prob`, ice reading the chosen
/// hidden grid.
pub fn build_overlays(
    mechanics: &[Mechanic],
    state: &State,
    solution: &[Move],
    seed: u32,
    density: MechanicDensity,
) -> OverlaySet {
    let mut set = empty_overlays(state);
    if mechanics.contains(&Mechanic::Hidden) {
        set.hidden = compute_hidden(
            state,
            seed,
            &exposable_cells(state, solution),
            density.hidden,
        );
    }
    if mechanics.contains(&Mechanic::Funnel) {
        set.funnels = compute_funnels(
            state,
            seed,
            &eligible_tubes(state, solution),
            density.funnel,
        );
    }
    if mechanics.contains(&Mechanic::Ice) {
        set.ice = build_ice(state, solution, &set.hidden, seed, density.ice);
    }
    set
}

/// Whether a candidate visibly shows every `requiresPresence` mechanic of the chapter
/// (funnels and ice; hidden is exempt) — the predicate behind `filterPresence`.
pub fn presence_ok(set: &OverlaySet, mechanics: &[Mechanic]) -> bool {
    if mechanics.contains(&Mechanic::Funnel) && !any_funnel(&set.funnels) {
        return false;
    }
    if mechanics.contains(&Mechanic::Ice) && !any_ice(&set.ice) {
        return false;
    }
    true
}
