//! The per-attempt gameplay rules — the F6 port of `src/store/session.ts`'s rule half. One
//! `view` per board state answers everything the UI renders and gates on (status, blocked/
//! frozen cells, selectable/capped tubes, legal pour targets), and one `plan_tap` decides a
//! tap's outcome (select / deselect / ignore / pour, with the post-pour board, revealed
//! concealment, and the cue facts). After this lands, JS keeps ZERO rule semantics: the store
//! applies outcomes and the components render the snapshot.

use crate::engine::{can_pour, is_won, pour};
use crate::funnels::{accepts, Funnels};
use crate::hidden::{any_hidden, is_capped, known_top_run, reveal_exposed};
use crate::ice::{any_frozen, capped_colors, frozen_masks, Ice};
use crate::state::{Hidden, State};
use crate::types::Move;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Playing,
    Won,
    Deadlocked,
    /// Only reported when the caller's stuck check says so — `view` takes it as an input
    /// (the registry lives in `wasm.rs`; native tests inject a closure result).
    Stuck,
}

/// Everything the UI needs about one board state. Masks are per-tube bitmasks over CURRENT
/// cells; flags are per-tube booleans.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct View {
    pub status: Status,
    /// Cells that stop the visible run and prevent capping (concealed "?"s + still-frozen).
    pub blocked: Vec<u16>,
    /// Still-frozen cells only (the ice tint rendering).
    pub frozen: Vec<u16>,
    /// Legal pour SOURCE (non-empty, not capped, visible run > 0).
    pub selectable: Vec<bool>,
    /// Finished-tube visual: full single color, fully revealed, nothing frozen inside.
    pub capped: Vec<bool>,
    /// Legal pour DESTINATION from `selected` (all-false when nothing is selected).
    pub pour_targets: Vec<bool>,
}

/// Whether the player has no legal pour — mirrors `noPlayerMove` exactly: a capped or
/// blocked-topped tube is no source; a mechanic-rejected destination is no escape.
fn no_player_move(state: &State, blocked: &[u16], funnels: &Funnels) -> bool {
    let n = state.tubes.len();
    for (from, (src, &mask)) in state.tubes.iter().zip(blocked).enumerate() {
        if src.is_empty() || is_capped(src, state.capacity, mask) {
            continue;
        }
        if known_top_run(src, mask) == 0 {
            continue;
        }
        let color = src.top().unwrap();
        for to in 0..n {
            if from != to && can_pour(state, from, to) && accepts(Some(funnels), to, color) {
                return false;
            }
        }
    }
    true
}

/// The full board snapshot. `stuck` is the caller-provided loop-check verdict (consulted only
/// when the board would otherwise be `Playing` — same short-circuit order as `deriveStatus`).
pub fn view(
    state: &State,
    hidden: &Hidden,
    funnels: &Funnels,
    ice: &Ice,
    selected: Option<usize>,
    stuck: impl FnOnce() -> bool,
) -> View {
    let frozen = frozen_masks(state, hidden, ice);
    let blocked: Vec<u16> = hidden.iter().zip(&frozen).map(|(h, f)| h | f).collect();

    let won = is_won(state);
    let blocks_completion = any_hidden(hidden) || any_frozen(state, hidden, ice);
    let status = if won && !blocks_completion {
        Status::Won
    } else if no_player_move(state, &blocked, funnels) {
        Status::Deadlocked
    } else if won {
        Status::Playing // sorted but mechanic-blocked, and a thawing/revealing move remains
    } else if stuck() {
        Status::Stuck
    } else {
        Status::Playing
    };

    let selectable: Vec<bool> = state
        .tubes
        .iter()
        .enumerate()
        .map(|(b, t)| {
            !t.is_empty()
                && !is_capped(t, state.capacity, blocked[b])
                && known_top_run(t, blocked[b]) > 0
        })
        .collect();
    let capped: Vec<bool> = state
        .tubes
        .iter()
        .enumerate()
        .map(|(b, t)| is_capped(t, state.capacity, hidden[b]) && frozen[b] == 0)
        .collect();
    let pour_targets: Vec<bool> = match selected {
        Some(from) if from < state.tubes.len() && selectable[from] => {
            let color = state.tubes[from].top().unwrap();
            (0..state.tubes.len())
                .map(|to| from != to && can_pour(state, from, to) && accepts(Some(funnels), to, color))
                .collect()
        }
        _ => vec![false; state.tubes.len()],
    };

    View { status, blocked, frozen, selectable, capped, pour_targets }
}

/// A tap's decided outcome — mirrors `TapPlan` plus the cue facts a pour produces.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TapOutcome {
    Ignore,
    Select { index: usize },
    Deselect,
    Pour {
        next: State,
        next_hidden: Hidden,
        mv: Move,
        /// A frozen cell thawed (cue: 'thaw' — outranks 'cap').
        thawed: bool,
        /// A color newly capped (cue: 'cap').
        newly_capped: bool,
    },
}

/// Decide what tapping `i` does — `planTap`, ported decision-for-decision, plus the
/// frozen/capped deltas `cueForTap` classifies on (computed here so JS needs no rule reads).
pub fn plan_tap(
    state: &State,
    hidden: &Hidden,
    funnels: &Funnels,
    ice: &Ice,
    selected: Option<usize>,
    i: usize,
) -> TapOutcome {
    let frozen = frozen_masks(state, hidden, ice);
    let blocked: Vec<u16> = hidden.iter().zip(&frozen).map(|(h, f)| h | f).collect();
    let is_selectable = |b: usize| {
        let t = &state.tubes[b];
        !t.is_empty()
            && !is_capped(t, state.capacity, blocked[b])
            && known_top_run(t, blocked[b]) > 0
    };

    let Some(from) = selected else {
        return if is_selectable(i) { TapOutcome::Select { index: i } } else { TapOutcome::Ignore };
    };
    if from == i {
        return TapOutcome::Deselect;
    }

    if can_pour(state, from, i) && accepts(Some(funnels), i, state.tubes[from].top().unwrap()) {
        let cap = known_top_run(&state.tubes[from], blocked[from]);
        let (next, mv) = pour(state, from, i, cap);
        let next_hidden = reveal_exposed(&next, hidden);
        // Cue facts against the post-pour, post-reveal board (same inputs as `cueForTap`).
        let frozen_before: u32 = frozen.iter().map(|m| m.count_ones()).sum();
        let frozen_after: u32 =
            frozen_masks(&next, &next_hidden, ice).iter().map(|m| m.count_ones()).sum();
        let capped_before = capped_colors(state, hidden, ice).count_ones();
        let capped_after = capped_colors(&next, &next_hidden, ice).count_ones();
        return TapOutcome::Pour {
            next,
            next_hidden,
            mv,
            thawed: frozen_after < frozen_before,
            newly_capped: capped_after > capped_before,
        };
    }

    if is_selectable(i) { TapOutcome::Select { index: i } } else { TapOutcome::Deselect }
}

/// The free-pour debug cheat: move the top run onto any tube with room, ignoring color and
/// mechanic rules entirely (engine geometry only), then reveal any surfaced concealment —
/// exactly the store's old `forcePour` + `revealExposed` pair. `None` when nothing can move.
pub fn force_pour(
    state: &State,
    hidden: &Hidden,
    from: usize,
    to: usize,
) -> Option<(State, Hidden, Move)> {
    if from == to {
        return None;
    }
    let src = &state.tubes[from];
    let dst = &state.tubes[to];
    if src.is_empty() {
        return None;
    }
    let room = state.capacity as usize - dst.len();
    if room == 0 {
        return None;
    }
    let count = crate::engine::top_run_length(src).min(room);
    let color = src.top().unwrap();
    let mut next = state.clone();
    next.tubes[from].pop_n(count);
    next.tubes[to].push_n(color, count);
    let mv = Move { from: from as u8, to: to as u8, count: count as u8, color };
    let revealed = reveal_exposed(&next, hidden);
    Some((next, revealed, mv))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ice::IceTube;
    use crate::state::Tube;
    use crate::types::NO_COLOR;

    fn state(tubes: Vec<&[u8]>, capacity: u8) -> State {
        State { tubes: tubes.into_iter().map(Tube::from_cells).collect(), capacity }
    }
    fn clear(state: &State) -> (Hidden, Funnels, Ice) {
        let n = state.tubes.len();
        (vec![0; n], vec![NO_COLOR; n], vec![IceTube::NONE; n])
    }

    #[test]
    fn view_statuses_mirror_derive_status() {
        // Won: fully sorted, nothing blocking.
        let s = state(vec![&[1, 1, 1, 1], &[]], 4);
        let (h, f, i) = clear(&s);
        assert_eq!(view(&s, &h, &f, &i, None, || false).status, Status::Won);

        // Sorted but concealed ⇒ still playing.
        let h2 = vec![0b0010u16, 0];
        assert_eq!(view(&s, &h2, &f, &i, None, || false).status, Status::Playing);

        // No legal move ⇒ deadlocked.
        let s3 = state(vec![&[1, 2, 1, 2], &[2, 1, 2, 1]], 4);
        let (h3, f3, i3) = clear(&s3);
        assert_eq!(view(&s3, &h3, &f3, &i3, None, || false).status, Status::Deadlocked);

        // Playing board flips to stuck only via the injected check.
        let s4 = state(vec![&[1, 2], &[2, 1], &[]], 4);
        let (h4, f4, i4) = clear(&s4);
        assert_eq!(view(&s4, &h4, &f4, &i4, None, || true).status, Status::Stuck);
        assert_eq!(view(&s4, &h4, &f4, &i4, None, || false).status, Status::Playing);
    }

    #[test]
    fn view_masks_and_targets() {
        let s = state(vec![&[1, 1], &[2], &[]], 4);
        let (h, f, i) = clear(&s);
        let v = view(&s, &h, &f, &i, Some(0), || false);
        assert_eq!(v.selectable, vec![true, true, false]);
        // From tube 0 (top color 1): tube 1 clashes, tube 2 is empty — only 2 accepts.
        assert_eq!(v.pour_targets, vec![false, false, true]);
    }

    #[test]
    fn plan_tap_pours_capped_to_visible_run_and_reveals() {
        let s = state(vec![&[2, 1, 1], &[], &[]], 4);
        let hidden = vec![0b0001u16, 0, 0]; // floor of tube 0 concealed
        let (_, f, i) = clear(&s);
        match plan_tap(&s, &hidden, &f, &i, Some(0), 1) {
            TapOutcome::Pour { next, next_hidden, mv, .. } => {
                assert_eq!(mv.count, 2); // the visible run of 1s, not the whole tube
                assert_eq!(next.tubes[0].cells(), &[2]);
                assert_eq!(next_hidden[0], 0); // surfacing revealed the floor cell
            }
            other => panic!("expected pour, got {other:?}"),
        }
    }

    #[test]
    fn plan_tap_select_deselect_semantics() {
        let s = state(vec![&[1], &[2], &[]], 4);
        let (h, f, i) = clear(&s);
        assert_eq!(plan_tap(&s, &h, &f, &i, None, 2), TapOutcome::Ignore); // empty tube
        assert_eq!(plan_tap(&s, &h, &f, &i, None, 0), TapOutcome::Select { index: 0 });
        assert_eq!(plan_tap(&s, &h, &f, &i, Some(0), 0), TapOutcome::Deselect);
        // Illegal pour onto a selectable tube switches the selection.
        assert_eq!(plan_tap(&s, &h, &f, &i, Some(0), 1), TapOutcome::Select { index: 1 });
    }

    #[test]
    fn force_pour_ignores_color_rules_but_reveals() {
        // Mismatched colors, and the destination has room for only ONE of the two-run — the
        // cheat still pours (engine geometry only), and the newly surfaced concealed cell
        // reveals.
        let s = state(vec![&[1, 1], &[2, 2, 2]], 4);
        let hidden = vec![0b0001u16, 0]; // floor of tube 0 concealed
        let (next, revealed, mv) = force_pour(&s, &hidden, 0, 1).expect("moves");
        assert_eq!(mv.count, 1);
        assert_eq!(next.tubes[1].cells(), &[2, 2, 2, 1]);
        assert_eq!(next.tubes[0].cells(), &[1]);
        assert_eq!(revealed[0], 0); // the concealed floor is now the top — revealed
        assert!(force_pour(&s, &hidden, 0, 0).is_none());
    }
}
