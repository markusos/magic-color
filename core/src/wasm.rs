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
use crate::live::{pick_best, LiveConfig, LivePlan};
use crate::progression::{Mechanic, MechanicDensity};
use crate::rng::Mulberry32;
use crate::search::{hint_move, Overlays};
use crate::session::{force_pour, plan_tap, view, Status, TapOutcome};
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
    let hidden: Hidden = if hidden.is_empty() {
        vec![0; n]
    } else {
        hidden.to_vec()
    };
    let funnels: Funnels = if funnels.is_empty() {
        vec![NO_COLOR; n]
    } else {
        funnels.to_vec()
    };
    let ice: Ice = if ice_pairs.is_empty() {
        vec![IceTube::NONE; n]
    } else {
        (0..n)
            .map(|b| {
                let trigger = ice_pairs[b * 2];
                let height = ice_pairs[b * 2 + 1];
                if trigger == NO_COLOR || height == 0 {
                    IceTube::NONE
                } else {
                    IceTube { trigger, height }
                }
            })
            .collect()
    };
    (state, hidden, funnels, ice)
}

/// A decoded board + its overlays — the boundary handle for the per-action gameplay calls
/// (F6). The JS adapter constructs one from the flat arrays (decode happens ONCE, in the
/// constructor), calls the cohesive `hint`/`view`/`tap`/`force_pour` methods, then frees it.
/// This replaced four free functions that each repeated the same 6-arg board+overlay prefix.
#[wasm_bindgen]
pub struct Board {
    state: State,
    hidden: Hidden,
    funnels: Funnels,
    ice: Ice,
}

#[wasm_bindgen]
impl Board {
    #[wasm_bindgen(constructor)]
    pub fn new(
        cells: &[u8],
        bottles: u8,
        capacity: u8,
        hidden: &[u16],
        funnels: &[u8],
        ice_pairs: &[u8],
    ) -> Board {
        let (state, hidden, funnels, ice) =
            decode(cells, bottles, capacity, hidden, funnels, ice_pairs);
        Board {
            state,
            hidden,
            funnels,
            ice,
        }
    }

    fn overlays(&self) -> Overlays<'_> {
        Overlays {
            funnels: Some(&self.funnels),
            ice: Some(&self.ice),
        }
    }

    /// First move of an optimal continuation (the in-game hint / auto-solve step), or `-1` when
    /// there is nothing to suggest (solved, stuck, or node budget exhausted). Encoded as
    /// `(from << 8) | to` — bottle counts are ≤ 15, so a byte each is generous.
    pub fn hint(&self, max_nodes: u32) -> i32 {
        match hint_move(
            &self.state,
            &self.hidden,
            self.overlays(),
            max_nodes as usize,
        ) {
            Some((from, to)) => ((from as i32) << 8) | to as i32,
            None => -1,
        }
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
pub fn stuck_check(
    cells: &[u8],
    bottles: u8,
    capacity: u8,
    funnels: &[u8],
    max_nodes: u32,
) -> bool {
    let (state, _, funnels, _) = decode(cells, bottles, capacity, &[], funnels, &[]);
    VISITED.with(|v| is_stuck_in_loop(&state, &v.borrow(), Some(&funnels), max_nodes as usize))
}

/// Registry size — for the E9 diagnostics readout and adapter tests.
#[wasm_bindgen]
pub fn stuck_visited_count() -> u32 {
    VISITED.with(|v| v.borrow().len() as u32)
}

// ------------------------------------------------------------------------------------------
// Gameplay session (F6): one sync `board_view` per state answers everything the UI renders
// and gates on; one `tap` decides a tap's outcome. The stuck verdict inside `board_view`
// consults the same VISITED registry the store maintains via stuck_reset/stuck_visit.
// ------------------------------------------------------------------------------------------

/// Flat `View` for the boundary: per-tube masks/flags + the status byte
/// (0 playing / 1 won / 2 deadlocked / 3 stuck).
#[wasm_bindgen(getter_with_clone)]
pub struct BoardView {
    pub status: u8,
    pub blocked: Vec<u16>,
    pub frozen: Vec<u16>,
    pub selectable: Vec<u8>,
    pub capped: Vec<u8>,
    pub pour_targets: Vec<u8>,
}

#[wasm_bindgen]
impl Board {
    /// The board snapshot (F6): status + per-tube masks/flags the UI renders and gates on.
    /// `selected` is `-1` for none; `stuck_max_nodes` bounds the loop check (which runs only
    /// when the board is otherwise in play — pass 0 on render paths to skip it entirely).
    pub fn view(&self, selected: i32, stuck_max_nodes: u32) -> BoardView {
        let v = view(
            &self.state,
            &self.hidden,
            &self.funnels,
            &self.ice,
            usize::try_from(selected).ok(),
            || {
                VISITED.with(|vis| {
                    is_stuck_in_loop(
                        &self.state,
                        &vis.borrow(),
                        Some(&self.funnels),
                        stuck_max_nodes as usize,
                    )
                })
            },
        );
        BoardView {
            status: match v.status {
                Status::Playing => 0,
                Status::Won => 1,
                Status::Deadlocked => 2,
                Status::Stuck => 3,
            },
            blocked: v.blocked,
            frozen: v.frozen,
            selectable: v.selectable.iter().map(|&b| b as u8).collect(),
            capped: v.capped.iter().map(|&b| b as u8).collect(),
            pour_targets: v.pour_targets.iter().map(|&b| b as u8).collect(),
        }
    }
}

/// A tap's outcome (F6). `kind`: 0 ignore / 1 select / 2 deselect / 3 pour. For a pour the
/// post-board, revealed concealment, executed move, and cue facts are populated.
#[wasm_bindgen(getter_with_clone)]
pub struct TapResult {
    pub kind: u8,
    /// The new selection for kind=select.
    pub select_index: u8,
    pub next_cells: Vec<u8>,
    pub next_hidden: Vec<u16>,
    /// Executed move for kind=pour: from, to, count, color.
    pub mv: Vec<u8>,
    pub thawed: bool,
    pub newly_capped: bool,
}

fn empty_tap(kind: u8) -> TapResult {
    TapResult {
        kind,
        select_index: 0,
        next_cells: Vec::new(),
        next_hidden: Vec::new(),
        mv: Vec::new(),
        thawed: false,
        newly_capped: false,
    }
}

#[wasm_bindgen]
impl Board {
    /// Decide what tapping tube `i` does (F6) — the core-side `planTap`.
    pub fn tap(&self, selected: i32, i: u8) -> TapResult {
        match plan_tap(
            &self.state,
            &self.hidden,
            &self.funnels,
            &self.ice,
            usize::try_from(selected).ok(),
            i as usize,
        ) {
            TapOutcome::Ignore => empty_tap(0),
            TapOutcome::Select { index } => {
                let mut t = empty_tap(1);
                t.select_index = index as u8;
                t
            }
            TapOutcome::Deselect => empty_tap(2),
            TapOutcome::Pour {
                next,
                next_hidden,
                mv,
                thawed,
                newly_capped,
            } => TapResult {
                kind: 3,
                select_index: 0,
                next_cells: encode_cells(&next),
                next_hidden,
                mv: vec![mv.from, mv.to, mv.count, mv.color],
                thawed,
                newly_capped,
            },
        }
    }

    /// The free-pour debug cheat (F6): engine-geometry-only move, mechanics ignored. Returns a
    /// pour-kind TapResult, or ignore-kind when nothing can move.
    pub fn force_pour(&self, from: u8, to: u8) -> TapResult {
        match force_pour(&self.state, &self.hidden, from as usize, to as usize) {
            None => empty_tap(0),
            Some((next, revealed, mv)) => TapResult {
                kind: 3,
                select_index: 0,
                next_cells: encode_cells(&next),
                next_hidden: revealed,
                mv: vec![mv.from, mv.to, mv.count, mv.color],
                thawed: false,
                newly_capped: false,
            },
        }
    }
}

/// Board → flat cell bytes (the shared boundary layout).
fn encode_cells(state: &State) -> Vec<u8> {
    let cap = state.capacity as usize;
    let mut cells = vec![NO_COLOR; state.tubes.len() * cap];
    for (b, t) in state.tubes.iter().enumerate() {
        for (i, &c) in t.cells().iter().enumerate() {
            cells[b * cap + i] = c;
        }
    }
    cells
}

// ------------------------------------------------------------------------------------------
// Live generation (F3): the whole coarse-to-fine pickBest loop runs core-side; the JS adapter
// passes the plan + curve target + budget and assembles the LoadedLevel from this result.
// ------------------------------------------------------------------------------------------

/// A chosen live board, flat-encoded for the boundary. Vec fields are exposed through
/// `getter_with_clone` (one copy per level load — negligible).
#[wasm_bindgen(getter_with_clone)]
pub struct LiveLevel {
    pub cells: Vec<u8>,
    pub bottles: u8,
    pub capacity: u8,
    /// `(from, to, count, color)` per move of the stored full-information solution.
    pub solution: Vec<u8>,
    pub hidden: Vec<u16>,
    pub funnels: Vec<u8>,
    /// `(trigger, height)` per tube.
    pub ice_pairs: Vec<u8>,
    pub optimal: u32,
    pub two_star_max: u32,
    pub par: u32,
    pub min_moves: u32,
    /// The pool seed the chosen board came from (salt-adjusted).
    pub seed: u32,
    /// The fine composite score the board was selected at (LiveProvenance).
    pub score: f64,
    // The chosen board's fine-pass metrics (LiveProvenance.metrics).
    pub m_optimal: u32,
    pub m_optimal_exact: bool,
    pub m_two_star_max: u32,
    pub m_forced_move_ratio: f64,
    pub m_dead_end_density: f64,
    pub m_dig_depth: f64,
    pub m_funnel_load: f64,
    pub m_ice_load: f64,
    pub m_colors: u32,
    pub m_empties: u32,
}

/// Run the live selection loop (`pickBest`) core-side. `mechanics_mask`: 1 = hidden,
/// 2 = funnel, 4 = ice (registry order is fixed internally). Returns `undefined` when every
/// salted pool comes up empty — the JS side then falls back to its light generator.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn generate_live(
    level: u32,
    colors: u8,
    bottles: u8,
    capacity: u8,
    seed: u32,
    mechanics_mask: u8,
    density_hidden: f64,
    density_funnel: f64,
    density_ice: f64,
    target: f64,
    pool_size: u32,
    finalists: u32,
    fine_dead_end_samples: u32,
) -> Option<LiveLevel> {
    let mut mechanics = Vec::new();
    if mechanics_mask & 1 != 0 {
        mechanics.push(Mechanic::Hidden);
    }
    if mechanics_mask & 2 != 0 {
        mechanics.push(Mechanic::Funnel);
    }
    if mechanics_mask & 4 != 0 {
        mechanics.push(Mechanic::Ice);
    }
    let plan = LivePlan {
        level: level as usize,
        colors: colors as usize,
        bottles: bottles as usize,
        capacity,
        seed,
        mechanics,
        density: MechanicDensity {
            hidden: density_hidden,
            funnel: density_funnel,
            ice: density_ice,
        },
    };
    let config = LiveConfig {
        pool_size: pool_size as usize,
        finalists: finalists as usize,
        fine_dead_end_samples: fine_dead_end_samples as usize,
    };

    let pick = pick_best(&plan, target, &config)?;
    let state = &pick.level.state;
    let cap = state.capacity as usize;
    let mut cells = vec![NO_COLOR; state.tubes.len() * cap];
    for (b, t) in state.tubes.iter().enumerate() {
        for (i, &c) in t.cells().iter().enumerate() {
            cells[b * cap + i] = c;
        }
    }
    let mut solution = Vec::with_capacity(pick.level.solution.len() * 4);
    for m in &pick.level.solution {
        solution.extend_from_slice(&[m.from, m.to, m.count, m.color]);
    }
    let mut ice_pairs = vec![0u8; state.tubes.len() * 2];
    for (b, it) in pick.overlays.ice.iter().enumerate() {
        ice_pairs[b * 2] = it.trigger;
        ice_pairs[b * 2 + 1] = it.height;
    }

    let m = &pick.metrics;
    Some(LiveLevel {
        cells,
        bottles: state.tubes.len() as u8,
        capacity: state.capacity,
        solution,
        hidden: pick.overlays.hidden.clone(),
        funnels: pick.overlays.funnels.clone(),
        ice_pairs,
        optimal: pick.optimal,
        two_star_max: pick.two_star_max,
        par: pick.level.par,
        min_moves: pick.level.min_moves as u32,
        seed: pick.level.seed,
        score: pick.score,
        m_optimal: m.optimal,
        m_optimal_exact: m.optimal_exact,
        m_two_star_max: m.two_star_max,
        m_forced_move_ratio: m.forced_move_ratio,
        m_dead_end_density: m.dead_end_density,
        m_dig_depth: m.dig_depth,
        m_funnel_load: m.funnel_load,
        m_ice_load: m.ice_load,
        m_colors: m.colors as u32,
        m_empties: m.empties as u32,
    })
}
