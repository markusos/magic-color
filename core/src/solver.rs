//! Full-information solver — port of `src/game/solver.ts`. The DFS explores the identical
//! node sequence as JS (same move enumeration order, same prune order, same node-budget
//! placement), so it returns the identical first solution — the property the bake's
//! byte-reproducibility rests on. The solver consults only `funnels` (deliberately not
//! ice-aware, same as JS).

use std::collections::HashSet;

use crate::engine::{is_won, legal_moves, pour};
use crate::funnels::{accepts, Funnels};
use crate::state::{state_key, Key, State};
use crate::types::Move;

pub const DEFAULT_MAX_NODES: usize = 200_000;

/// Order-independent canonical key for a full-information state.
pub fn canonical(state: &State) -> Key {
    state_key(state, None)
}

/// Prune moves that can never help — port of `isUsefulMove` (finished-solid-block moves,
/// redundant empties collapsed to the first ACCEPTING empty, funnel-rejected pours).
fn is_useful_move(state: &State, from: usize, to: usize, funnels: Option<&Funnels>) -> bool {
    let src = &state.tubes[from];
    let dst = &state.tubes[to];

    let color = src.top().unwrap();
    if !accepts(funnels, to, color) {
        return false;
    }

    let src_uniform = src.is_uniform();
    if src_uniform && dst.is_empty() {
        return false; // moving a solid block to empty = no progress
    }

    if dst.is_empty() {
        let first_empty = state
            .tubes
            .iter()
            .enumerate()
            .position(|(idx, b)| b.is_empty() && accepts(funnels, idx, color));
        if Some(to) != first_empty {
            return false;
        }
    }
    true
}

/// The legal moves worth considering — `legal_moves` minus the `is_useful_move` prunes, in
/// canonical order.
pub fn useful_moves(state: &State, funnels: Option<&Funnels>) -> Vec<(u8, u8)> {
    legal_moves(state)
        .into_iter()
        .filter(|&(from, to)| is_useful_move(state, from as usize, to as usize, funnels))
        .collect()
}

pub struct SolveResult {
    pub solution: Option<Vec<Move>>,
    /// True when the whole reachable space was explored within budget — a `None` solution
    /// with `exhausted` is a *proof* of unsolvability.
    pub exhausted: bool,
}

struct Frame {
    state: State,
    moves: Vec<(u8, u8)>,
    next: usize,
}

/// Iterative pre-order DFS for *a* solution — structurally identical to the JS `search`
/// (goal check before the node count, node count before the visited check), so node budgets
/// bite at the same points and the first solution found is the same.
pub fn search(state: &State, funnels: Option<&Funnels>, max_nodes: usize) -> SolveResult {
    let mut visited: HashSet<Key> = HashSet::new();
    let mut nodes = 0usize;
    let mut hit_cap = false;

    let mut path: Vec<Move> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();

    enum Entered {
        Won,
        Pruned,
        Pushed,
    }

    let enter = |current: State,
                 stack: &mut Vec<Frame>,
                 nodes: &mut usize,
                 hit_cap: &mut bool,
                 visited: &mut HashSet<Key>|
     -> Entered {
        if is_won(&current) {
            return Entered::Won;
        }
        *nodes += 1;
        if *nodes > max_nodes {
            *hit_cap = true;
            return Entered::Pruned;
        }
        let key = canonical(&current);
        if !visited.insert(key) {
            return Entered::Pruned;
        }
        let moves = useful_moves(&current, funnels);
        stack.push(Frame {
            state: current,
            moves,
            next: 0,
        });
        Entered::Pushed
    };

    if matches!(
        enter(
            state.clone(),
            &mut stack,
            &mut nodes,
            &mut hit_cap,
            &mut visited
        ),
        Entered::Won
    ) {
        return SolveResult {
            solution: Some(Vec::new()),
            exhausted: !hit_cap,
        };
    }

    while let Some(frame) = stack.last_mut() {
        if frame.next >= frame.moves.len() {
            stack.pop();
            if !stack.is_empty() {
                path.pop(); // a non-root frame: drop the move that led into it
            }
            continue;
        }
        let (from, to) = frame.moves[frame.next];
        frame.next += 1;
        let (next, mv) = pour(&frame.state, from as usize, to as usize, usize::MAX);
        path.push(mv);
        match enter(next, &mut stack, &mut nodes, &mut hit_cap, &mut visited) {
            Entered::Won => {
                return SolveResult {
                    solution: Some(path),
                    exhausted: !hit_cap,
                }
            }
            Entered::Pruned => {
                path.pop();
            }
            Entered::Pushed => {}
        }
    }

    SolveResult {
        solution: None,
        exhausted: !hit_cap,
    }
}

pub fn solve(state: &State, funnels: Option<&Funnels>, max_nodes: usize) -> Option<Vec<Move>> {
    search(state, funnels, max_nodes).solution
}

pub fn is_solvable(state: &State, funnels: Option<&Funnels>, max_nodes: usize) -> bool {
    solve(state, funnels, max_nodes).is_some()
}

pub fn is_unsolvable(state: &State, funnels: Option<&Funnels>, max_nodes: usize) -> bool {
    let r = search(state, funnels, max_nodes);
    r.solution.is_none() && r.exhausted
}

/// Whether every reachable state has already been visited this attempt — port of
/// `isStuckInLoop` (conservative: inconclusive budget or any fresh state ⇒ `false`).
pub fn is_stuck_in_loop(
    state: &State,
    visited: &HashSet<Key>,
    funnels: Option<&Funnels>,
    max_nodes: usize,
) -> bool {
    let mut seen: HashSet<Key> = HashSet::from([canonical(state)]);
    let mut stack: Vec<State> = vec![state.clone()];
    let mut nodes = 0usize;

    while let Some(current) = stack.pop() {
        nodes += 1;
        if nodes > max_nodes {
            return false; // inconclusive — don't nag
        }
        for (from, to) in legal_moves(&current) {
            if !is_useful_move(&current, from as usize, to as usize, funnels) {
                continue;
            }
            let (next, _) = pour(&current, from as usize, to as usize, usize::MAX);
            if is_won(&next) {
                return false;
            }
            let key = canonical(&next);
            if !visited.contains(&key) {
                return false; // somewhere new to go
            }
            if !seen.insert(key) {
                continue;
            }
            stack.push(next);
        }
    }
    true
}

/// Layered BFS for the minimum full-information move count — port of `bfsOptimal` (node
/// budget counted on NEW states, after the visited check, exactly like JS).
pub fn bfs_optimal(state: &State, funnels: Option<&Funnels>, max_nodes: usize) -> Option<usize> {
    if is_won(state) {
        return Some(0);
    }
    let mut visited: HashSet<Key> = HashSet::from([canonical(state)]);
    let mut frontier: Vec<State> = vec![state.clone()];
    let mut depth = 0usize;
    let mut nodes = 0usize;

    while !frontier.is_empty() {
        let mut next_frontier: Vec<State> = Vec::new();
        depth += 1;
        for current in &frontier {
            for (from, to) in legal_moves(current) {
                if !is_useful_move(current, from as usize, to as usize, funnels) {
                    continue;
                }
                let (child, _) = pour(current, from as usize, to as usize, usize::MAX);
                if is_won(&child) {
                    return Some(depth);
                }
                let key = canonical(&child);
                if !visited.insert(key) {
                    continue;
                }
                nodes += 1;
                if nodes > max_nodes {
                    return None;
                }
                next_frontier.push(child);
            }
        }
        frontier = next_frontier;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Tube;

    fn state(tubes: Vec<&[u8]>, capacity: u8) -> State {
        State {
            tubes: tubes.into_iter().map(Tube::from_cells).collect(),
            capacity,
        }
    }

    #[test]
    fn solves_a_trivial_board() {
        let s = state(vec![&[1, 1, 1], &[1], &[]], 4);
        let solution = solve(&s, None, DEFAULT_MAX_NODES).expect("solvable");
        assert!(!solution.is_empty());
        let mut cur = s;
        for m in &solution {
            cur = pour(&cur, m.from as usize, m.to as usize, usize::MAX).0;
        }
        assert!(is_won(&cur));
    }

    #[test]
    fn proves_unsolvable_when_exhausted() {
        // Two full mixed tubes, no free space: exhaustively unwinnable.
        let s = state(vec![&[0, 1, 0, 1], &[1, 0, 1, 0]], 4);
        assert!(is_unsolvable(&s, None, DEFAULT_MAX_NODES));
    }

    #[test]
    fn bfs_matches_obvious_optimum() {
        let s = state(vec![&[1, 1, 1], &[1], &[]], 4);
        assert_eq!(bfs_optimal(&s, None, DEFAULT_MAX_NODES), Some(1));
    }
}
