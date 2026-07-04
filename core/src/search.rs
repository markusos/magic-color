//! Capped, mechanic-aware search — port of `src/game/search.ts`: the player-rule successor
//! generator (pours capped to the visible run, reveals on surfacing, funnel/ice aware), the
//! exact A* optimum, the star-cutoff tier sweep, and the hint search. The binary heap is a
//! structural copy of the JS `MinHeap` so tie-breaking (which can decide *which* optimal hint
//! is returned) matches too.

use std::collections::HashMap;

use crate::engine::{can_pour, is_won, pour};
use crate::funnels::{accepts, Funnels};
use crate::hidden::{any_hidden, is_capped, known_top_run, reveal_exposed};
use crate::ice::{any_frozen, frozen_masks, Ice};
use crate::state::{state_key, Hidden, Key, State};

/// The static mechanic overlays a search honors (JS `Overlays`). `None` fields ⇒ the
/// un-mechanic'd game.
#[derive(Clone, Copy, Default)]
pub struct Overlays<'a> {
    pub funnels: Option<&'a Funnels>,
    pub ice: Option<&'a Ice>,
}

/// Binary min-heap replicated from the JS `MinHeap` (same sift comparisons, same swap order)
/// so equal-priority pops come out in the same order.
struct MinHeap<T> {
    items: Vec<T>,
    cmp: fn(&T, &T) -> i64,
}

impl<T> MinHeap<T> {
    fn new(cmp: fn(&T, &T) -> i64) -> Self {
        MinHeap { items: Vec::new(), cmp }
    }

    fn len(&self) -> usize {
        self.items.len()
    }

    fn push(&mut self, value: T) {
        let a = &mut self.items;
        a.push(value);
        let mut i = a.len() - 1;
        while i > 0 {
            let p = (i - 1) >> 1;
            if (self.cmp)(&a[i], &a[p]) >= 0 {
                break;
            }
            a.swap(i, p);
            i = p;
        }
    }

    fn pop(&mut self) -> Option<T> {
        let a = &mut self.items;
        if a.is_empty() {
            return None;
        }
        let last = a.pop().unwrap();
        if a.is_empty() {
            return Some(last);
        }
        let top = std::mem::replace(&mut a[0], last);
        let mut i = 0;
        loop {
            let l = 2 * i + 1;
            let r = l + 1;
            let mut s = i;
            if l < a.len() && (self.cmp)(&a[l], &a[s]) < 0 {
                s = l;
            }
            if r < a.len() && (self.cmp)(&a[r], &a[s]) < 0 {
                s = r;
            }
            if s == i {
                break;
            }
            a.swap(i, s);
            i = s;
        }
        Some(top)
    }
}

/// Admissible heuristic: (monochrome runs) − (distinct colors).
pub fn runs_heuristic(state: &State) -> i64 {
    let mut runs: i64 = 0;
    let mut colors: u16 = 0;
    for t in &state.tubes {
        for i in 0..t.len() {
            colors |= 1 << t.cell(i);
            if i == 0 || t.cell(i) != t.cell(i - 1) {
                runs += 1;
            }
        }
    }
    runs - colors.count_ones() as i64
}

struct CappedSuccessor {
    state: State,
    hidden: Hidden,
    mv: (u8, u8),
}

/// States reachable by one CAPPED player pour — port of `cappedSuccessors`, same enumeration
/// order (from asc × to asc) and the same prunes (capped tubes, frozen tops, representative
/// empties, solid-block-to-empty).
fn capped_successors(state: &State, hidden: &Hidden, overlays: Overlays) -> Vec<CappedSuccessor> {
    let n = state.tubes.len();
    let mut out = Vec::new();
    let frozen = overlays.ice.map(|ice| frozen_masks(state, hidden, ice));
    let blocked_of = |i: usize| -> u16 {
        match &frozen {
            None => hidden[i],
            Some(fr) => hidden[i] | fr[i],
        }
    };
    for from in 0..n {
        let src = &state.tubes[from];
        let blocked = blocked_of(from);
        if src.is_empty() || is_capped(src, state.capacity, blocked) {
            continue;
        }
        let cap = known_top_run(src, blocked);
        if cap == 0 {
            continue; // top is frozen ⇒ nothing pourable until it thaws
        }
        let src_color = src.top().unwrap();
        let src_uniform = src.is_uniform();
        let src_concealed = blocked != 0;
        let first_empty = state
            .tubes
            .iter()
            .enumerate()
            .position(|(idx, b)| b.is_empty() && accepts(overlays.funnels, idx, src_color));
        for to in 0..n {
            if from == to {
                continue;
            }
            let dst = &state.tubes[to];
            if !can_pour(state, from, to) {
                continue;
            }
            if !accepts(overlays.funnels, to, src_color) {
                continue;
            }
            if dst.is_empty() {
                if Some(to) != first_empty {
                    continue; // equivalent empties collapse to their representative
                }
                if src_uniform && !src_concealed {
                    continue; // relocating a fully-revealed solid block is never progress
                }
            }
            let (next, _) = pour(state, from, to, cap);
            let next_hidden = reveal_exposed(&next, hidden);
            out.push(CappedSuccessor { state: next, hidden: next_hidden, mv: (from as u8, to as u8) });
        }
    }
    out
}

/// The capped-successor move set at a state, in canonical order — the G2 trace's payload:
/// exactly the moves the player-rule searches consider.
pub fn capped_move_set(state: &State, hidden: &Hidden, overlays: Overlays) -> Vec<(u8, u8)> {
    capped_successors(state, hidden, overlays).iter().map(|s| s.mv).collect()
}

/// Apply one capped player move (as the searches would), or `None` if it isn't in the
/// capped-successor set. Trace-tool convenience; O(successors) is fine off the hot path.
pub fn apply_capped_move(
    state: &State,
    hidden: &Hidden,
    overlays: Overlays,
    mv: (u8, u8),
) -> Option<(State, Hidden)> {
    capped_successors(state, hidden, overlays)
        .into_iter()
        .find(|s| s.mv == mv)
        .map(|s| (s.state, s.hidden))
}

/// Fully solved, revealed, and thawed — the search goal.
fn is_solved(state: &State, hidden: &Hidden, overlays: Overlays) -> bool {
    is_won(state)
        && !any_hidden(hidden)
        && !overlays.ice.is_some_and(|ice| any_frozen(state, hidden, ice))
}

struct AStarNode {
    state: State,
    hidden: Hidden,
    g: u32,
    f: i64,
    key: Key,
    first: Option<(u8, u8)>,
}

fn astar_cmp(a: &AStarNode, b: &AStarNode) -> i64 {
    a.f - b.f
}

/// Shared A* core for `optimal_capped_moves` (returns the depth) and `hint_move` (returns the
/// root move carried along the optimal path). Node budget bites on pop, exactly like JS.
fn astar(
    state0: &State,
    hidden0: &Hidden,
    max_nodes: usize,
    overlays: Overlays,
) -> Option<(u32, Option<(u8, u8)>)> {
    let key0 = state_key(state0, Some(hidden0));
    let mut best_g: HashMap<Key, u32> = HashMap::from([(key0.clone(), 0)]);
    let mut heap: MinHeap<AStarNode> = MinHeap::new(astar_cmp);
    heap.push(AStarNode {
        state: state0.clone(),
        hidden: hidden0.clone(),
        g: 0,
        f: runs_heuristic(state0),
        key: key0,
        first: None,
    });

    let mut nodes = 0usize;
    while heap.len() > 0 {
        let cur = heap.pop().unwrap();
        if best_g.get(&cur.key).copied().unwrap_or(u32::MAX) < cur.g {
            continue; // stale heap entry
        }
        if is_solved(&cur.state, &cur.hidden, overlays) {
            return Some((cur.g, cur.first));
        }
        nodes += 1;
        if nodes > max_nodes {
            return None;
        }

        for succ in capped_successors(&cur.state, &cur.hidden, overlays) {
            let next_key = state_key(&succ.state, Some(&succ.hidden));
            let ng = cur.g + 1;
            if ng < best_g.get(&next_key).copied().unwrap_or(u32::MAX) {
                best_g.insert(next_key.clone(), ng);
                let f = ng as i64 + runs_heuristic(&succ.state);
                heap.push(AStarNode {
                    state: succ.state,
                    hidden: succ.hidden,
                    g: ng,
                    f,
                    key: next_key,
                    first: cur.first.or(Some(succ.mv)),
                });
            }
        }
    }
    None
}

/// Exact minimum player pours (capped/reveal/overlay-aware A*), or `None` on budget
/// exhaustion — port of `optimalCappedMoves`.
pub fn optimal_capped_moves(
    state0: &State,
    hidden0: &Hidden,
    max_nodes: usize,
    overlays: Overlays,
) -> Option<u32> {
    // The JS A* does not early-return on an already-solved root (it pops it as g=0).
    astar(state0, hidden0, max_nodes, overlays).map(|(g, _)| g)
}

/// First move of an optimal continuation, or `None` (solved / stuck / budget) — port of
/// `hintMove`.
pub fn hint_move(
    state0: &State,
    hidden0: &Hidden,
    overlays: Overlays,
    max_nodes: usize,
) -> Option<(u8, u8)> {
    if is_solved(state0, hidden0, overlays) {
        return None;
    }
    astar(state0, hidden0, max_nodes, overlays).and_then(|(_, first)| first)
}

/// The full optimal line (every pour of an optimal capped solve), for the bake's golden
/// winning-line artifact (gate G3: JS replays this and must win in exactly `optimal` pours).
/// Same A* as `optimal_capped_moves` plus a parent map for path reconstruction — bake-only,
/// so the extra memory never ships to the runtime paths.
pub fn optimal_capped_line(
    state0: &State,
    hidden0: &Hidden,
    max_nodes: usize,
    overlays: Overlays,
) -> Option<Vec<(u8, u8)>> {
    let key0 = state_key(state0, Some(hidden0));
    let mut best_g: HashMap<Key, u32> = HashMap::from([(key0.clone(), 0)]);
    let mut came_from: HashMap<Key, (Key, (u8, u8))> = HashMap::new();
    let mut heap: MinHeap<AStarNode> = MinHeap::new(astar_cmp);
    heap.push(AStarNode {
        state: state0.clone(),
        hidden: hidden0.clone(),
        g: 0,
        f: runs_heuristic(state0),
        key: key0,
        first: None,
    });

    let mut nodes = 0usize;
    while heap.len() > 0 {
        let cur = heap.pop().unwrap();
        if best_g.get(&cur.key).copied().unwrap_or(u32::MAX) < cur.g {
            continue;
        }
        if is_solved(&cur.state, &cur.hidden, overlays) {
            let mut line = Vec::with_capacity(cur.g as usize);
            let mut key = cur.key;
            while let Some((parent, mv)) = came_from.get(&key) {
                line.push(*mv);
                key = parent.clone();
            }
            line.reverse();
            return Some(line);
        }
        nodes += 1;
        if nodes > max_nodes {
            return None;
        }

        for succ in capped_successors(&cur.state, &cur.hidden, overlays) {
            let next_key = state_key(&succ.state, Some(&succ.hidden));
            let ng = cur.g + 1;
            if ng < best_g.get(&next_key).copied().unwrap_or(u32::MAX) {
                best_g.insert(next_key.clone(), ng);
                came_from.insert(next_key.clone(), (cur.key.clone(), succ.mv));
                let f = ng as i64 + runs_heuristic(&succ.state);
                heap.push(AStarNode {
                    state: succ.state,
                    hidden: succ.hidden,
                    g: ng,
                    f,
                    key: next_key,
                    first: None,
                });
            }
        }
    }
    None
}

pub struct StarCutoffs {
    pub optimal: u32,
    pub two_star_max: u32,
}

/// Star cutoffs via the layered tier sweep — port of `nearOptimalCutoffs`. Layers preserve
/// insertion order (JS `Map`) so the node budget bites at the same successor, making early
/// (budget-hit) results identical too.
pub fn near_optimal_cutoffs(
    state0: &State,
    hidden0: &Hidden,
    max_nodes: usize,
    overlays: Overlays,
) -> Option<StarCutoffs> {
    struct Entry {
        state: State,
        hidden: Hidden,
    }
    let mut layer: Vec<Entry> = vec![Entry { state: state0.clone(), hidden: hidden0.clone() }];
    let mut goal_depths: Vec<u32> = Vec::new();
    let mut depth: u32 = 0;
    let mut nodes = 0usize;

    let finalize = |goal_depths: &[u32]| -> Option<StarCutoffs> {
        let optimal = *goal_depths.first()?;
        let two_star_max = goal_depths
            .get(2)
            .or_else(|| goal_depths.get(1))
            .copied()
            .unwrap_or(optimal + 2);
        Some(StarCutoffs { optimal, two_star_max })
    };

    while !layer.is_empty() {
        if layer.iter().any(|e| is_solved(&e.state, &e.hidden, overlays)) {
            goal_depths.push(depth);
            if goal_depths.len() >= 3 {
                break;
            }
        }

        let mut next: Vec<Entry> = Vec::new();
        let mut next_keys: std::collections::HashSet<Key> = std::collections::HashSet::new();
        for e in &layer {
            if is_solved(&e.state, &e.hidden, overlays) {
                continue; // solved boards have no useful successors
            }
            for succ in capped_successors(&e.state, &e.hidden, overlays) {
                nodes += 1;
                if nodes > max_nodes {
                    return finalize(&goal_depths);
                }
                let key = state_key(&succ.state, Some(&succ.hidden));
                if next_keys.insert(key) {
                    next.push(Entry { state: succ.state, hidden: succ.hidden });
                }
            }
        }
        layer = next;
        depth += 1;
    }

    finalize(&goal_depths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{empty_hidden, Tube};

    fn state(tubes: Vec<&[u8]>, capacity: u8) -> State {
        State { tubes: tubes.into_iter().map(Tube::from_cells).collect(), capacity }
    }

    #[test]
    fn capped_optimum_counts_run_splits() {
        // Balanced two-color board: solvable in 3 bulk pours; concealment splits runs and
        // forces extra player pours.
        let s = state(vec![&[2, 1, 1, 1], &[1, 2, 2, 2], &[]], 4);
        let no_hidden = empty_hidden(&s);
        assert_eq!(optimal_capped_moves(&s, &no_hidden, 10_000, Overlays::default()), Some(3));

        let hidden = vec![0b0010u16, 0, 0]; // conceal tube 0, cell 1
        let capped = optimal_capped_moves(&s, &hidden, 10_000, Overlays::default()).unwrap();
        assert!(capped > 3, "concealment must cost extra pours, got {capped}");
    }

    #[test]
    fn hint_returns_a_legal_first_move() {
        let s = state(vec![&[1, 1, 1], &[1], &[]], 4);
        let hidden = empty_hidden(&s);
        let hint = hint_move(&s, &hidden, Overlays::default(), 10_000).expect("hint");
        assert!(can_pour(&s, hint.0 as usize, hint.1 as usize));
    }

    #[test]
    fn cutoffs_start_at_the_optimal() {
        let s = state(vec![&[2, 1, 1], &[1, 2, 2], &[], &[]], 3);
        let hidden = empty_hidden(&s);
        let cut = near_optimal_cutoffs(&s, &hidden, 100_000, Overlays::default()).expect("cutoffs");
        assert_eq!(
            Some(cut.optimal),
            optimal_capped_moves(&s, &hidden, 100_000, Overlays::default())
        );
        assert!(cut.two_star_max > cut.optimal);
    }
}
