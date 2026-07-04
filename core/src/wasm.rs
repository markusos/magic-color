//! wasm-bindgen surface for the browser runtime (F3). Everything crossing the boundary is
//! flat numbers/arrays — no serde, no JSON: boards as `bottles × capacity` cell bytes
//! (bottle-major, bottom-first, `NO_COLOR` above the fill), concealment as per-tube u16
//! masks, funnels as per-tube color bytes, ice as per-tube `(trigger, height)` byte pairs.
//! Color bytes are palette indices; the JS adapter (`src/game/coreWasm.ts`) owns id↔index.
//!
//! Two consumers, same module: the hint/auto-solve WORKER (async seam, replaces
//! `hintWorker.ts` when the admin flag is on) and the MAIN THREAD (sync calls — the
//! stuck-loop check below and, come F6, the whole gameplay surface).

use std::cell::RefCell;
use std::collections::HashSet;

use wasm_bindgen::prelude::*;

use crate::funnels::Funnels;
use crate::ice::{Ice, IceTube};
use crate::rng::Mulberry32;
use crate::search::{hint_move, Overlays};
use crate::solver::{canonical, is_stuck_in_loop};
use crate::state::{Hidden, Key, State, Tube};
use crate::types::NO_COLOR;

/// Core build version, for the diagnostics readout (E9/F5: "show core: wasm/js").
#[wasm_bindgen]
pub fn core_version() -> String {
    crate::CORE_VERSION.to_string()
}

/// First `n` draws of `mulberry32(seed)` — the F0 boundary smoke test, kept as a cheap
/// self-check the adapter can assert at init.
#[wasm_bindgen]
pub fn rng_sample(seed: u32, n: u32) -> Vec<f64> {
    let mut rng = Mulberry32::new(seed);
    (0..n).map(|_| rng.next_f64()).collect()
}

/// Decode the flat boundary arrays into internal state. `cells.len()` must be
/// `bottles * capacity`; `ice_pairs` is `(trigger, height)` per tube, `NO_COLOR` trigger =
/// no ice. Empty overlay slices mean "absent" (all-clear), so callers that only need the
/// board (the stuck registry) can pass `&[]`.
fn decode(
    cells: &[u8],
    bottles: u8,
    capacity: u8,
    hidden: &[u16],
    funnels: &[u8],
    ice_pairs: &[u8],
) -> (State, Hidden, Funnels, Ice) {
    let n = bottles as usize;
    let cap = capacity as usize;
    let tubes = (0..n)
        .map(|b| {
            let col = &cells[b * cap..(b + 1) * cap];
            let fill = col.iter().take_while(|&&c| c != NO_COLOR).count();
            Tube::from_cells(&col[..fill])
        })
        .collect();
    let state = State { tubes, capacity };
    let hidden: Hidden = if hidden.is_empty() { vec![0; n] } else { hidden.to_vec() };
    let funnels: Funnels = if funnels.is_empty() { vec![NO_COLOR; n] } else { funnels.to_vec() };
    let ice: Ice = if ice_pairs.is_empty() {
        vec![IceTube::NONE; n]
    } else {
        (0..n)
            .map(|b| {
                let trigger = ice_pairs[b * 2];
                let height = ice_pairs[b * 2 + 1];
                if trigger == NO_COLOR || height == 0 { IceTube::NONE } else { IceTube { trigger, height } }
            })
            .collect()
    };
    (state, hidden, funnels, ice)
}

/// First move of an optimal continuation (the in-game hint / auto-solve step), or `-1` when
/// there is nothing to suggest (solved, stuck, or node budget exhausted). Encoded as
/// `(from << 8) | to` — bottle counts are ≤ 15, so a byte each is generous.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn hint(
    cells: &[u8],
    bottles: u8,
    capacity: u8,
    hidden: &[u16],
    funnels: &[u8],
    ice_pairs: &[u8],
    max_nodes: u32,
) -> i32 {
    let (state, hidden, funnels, ice) = decode(cells, bottles, capacity, hidden, funnels, ice_pairs);
    let overlays = Overlays { funnels: Some(&funnels), ice: Some(&ice) };
    match hint_move(&state, &hidden, overlays, max_nodes as usize) {
        Some((from, to)) => ((from as i32) << 8) | to as i32,
        None => -1,
    }
}

// ------------------------------------------------------------------------------------------
// Stuck-loop detection with the visited set held CORE-SIDE (the F3 design point, resolved per
// the F6 note: keys never cross the boundary, so F5/F6 can delete stateKey/canonical from
// JS). The store calls `stuck_reset` when a board is (re)installed, `stuck_visit` after every
// applied move, and `stuck_check` when deriving status. wasm is single-threaded per
// instantiation, so a thread_local RefCell is safe; the worker and main-thread copies each
// hold their own registry (only the main thread uses this one).
// ------------------------------------------------------------------------------------------

thread_local! {
    static VISITED: RefCell<HashSet<Key>> = RefCell::new(HashSet::new());
}

/// Start a fresh attempt: clear the registry and record the initial board.
#[wasm_bindgen]
pub fn stuck_reset(cells: &[u8], bottles: u8, capacity: u8) {
    let (state, ..) = decode(cells, bottles, capacity, &[], &[], &[]);
    VISITED.with(|v| {
        let mut v = v.borrow_mut();
        v.clear();
        v.insert(canonical(&state));
    });
}

/// Record a reached board (call after every applied move — including undo targets, which are
/// already present from their first visit).
#[wasm_bindgen]
pub fn stuck_visit(cells: &[u8], bottles: u8, capacity: u8) {
    let (state, ..) = decode(cells, bottles, capacity, &[], &[], &[]);
    VISITED.with(|v| {
        v.borrow_mut().insert(canonical(&state));
    });
}

/// Whether the player is provably circling (every reachable state already visited this
/// attempt) — the core-side `isStuckInLoop`, same conservative semantics (budget-inconclusive
/// ⇒ false).
#[wasm_bindgen]
pub fn stuck_check(cells: &[u8], bottles: u8, capacity: u8, funnels: &[u8], max_nodes: u32) -> bool {
    let (state, _, funnels, _) = decode(cells, bottles, capacity, &[], funnels, &[]);
    VISITED.with(|v| is_stuck_in_loop(&state, &v.borrow(), Some(&funnels), max_nodes as usize))
}

/// Registry size — for the E9 diagnostics readout and adapter tests.
#[wasm_bindgen]
pub fn stuck_visited_count() -> u32 {
    VISITED.with(|v| v.borrow().len() as u32)
}
