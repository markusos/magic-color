//! Conformance pinning: replay `vectors/solver.json` — FROZEN golden vectors, emitted from the
//! (since-retired) JS implementation at the port cutover — and require exact agreement on
//! everything the port claims to reproduce — generated boards + DFS solutions (generator/solver/rng parity in one), the
//! three mechanic overlays (RNG draw alignment), capped-search results including budget
//! exhaustion (`null` must match `None`: budgets must bite at the same node), and per-step
//! useful-move sets along the solution replay (the G2 seed).

use magic_color_core::engine::pour;
use magic_color_core::funnels::{compute_funnels, eligible_tubes, FUNNEL_PROB};
use magic_color_core::generator::{generate_level, GenerateOptions, ParMode};
use magic_color_core::hidden::{capped_solve_moves, compute_hidden, exposable_cells, HIDDEN_PROB};
use magic_color_core::ice::{build_ice, IceTube, ICE_PROB};
use magic_color_core::search::{hint_move, near_optimal_cutoffs, optimal_capped_moves, Overlays};
use magic_color_core::solver::{bfs_optimal, useful_moves, DEFAULT_MAX_NODES};
use magic_color_core::state::{State, Tube};
use magic_color_core::types::{Move, NO_COLOR};
use serde::Deserialize;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    options: Options,
    state: Vec<Vec<u8>>,
    solution: Vec<JsMove>,
    par: u32,
    min_moves: usize,
    bfs_optimal: Option<usize>,
    hidden: Vec<u16>,
    capped_solve_moves: usize,
    funnels: Vec<Option<u8>>,
    ice: Vec<JsIce>,
    capped_budget: usize,
    optimal_capped: Option<u32>,
    cutoff_budget: usize,
    cutoffs: Option<JsCutoffs>,
    hint_budget: usize,
    hint: Option<(u8, u8)>,
    final_cells: Vec<Vec<u8>>,
    trace: Vec<TraceStep>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Options {
    colors: usize,
    bottles: usize,
    capacity: u8,
    seed: u32,
    min_par: Option<u32>,
    par_mode: String,
}

#[derive(Deserialize)]
struct JsMove {
    from: u8,
    to: u8,
    count: u8,
    color: u8,
}

#[derive(Deserialize)]
struct JsIce {
    trigger: Option<u8>,
    height: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsCutoffs {
    optimal: u32,
    two_star_max: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraceStep {
    step: usize,
    useful_moves: Vec<(u8, u8)>,
    cells: Option<Vec<Vec<u8>>>,
}

fn state_of(cells: &[Vec<u8>], capacity: u8) -> State {
    State {
        tubes: cells.iter().map(|c| Tube::from_cells(c)).collect(),
        capacity,
    }
}

fn moves_of(moves: &[JsMove]) -> Vec<Move> {
    moves
        .iter()
        .map(|m| Move {
            from: m.from,
            to: m.to,
            count: m.count,
            color: m.color,
        })
        .collect()
}

#[test]
fn solver_vectors_replay_exactly() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../vectors/solver.json");
    let raw = std::fs::read_to_string(path)
        .expect("vectors/solver.json missing — the committed golden vectors were deleted?");
    let vectors: Vectors = serde_json::from_str(&raw).unwrap();
    assert!(!vectors.cases.is_empty());

    for case in &vectors.cases {
        let o = &case.options;
        let tag = format!(
            "case {}c/{}b/cap{} seed {}",
            o.colors, o.bottles, o.capacity, o.seed
        );

        // Generator + solver + rng parity: the seed must reproduce the identical board,
        // solution, par, and minMoves.
        let level = generate_level(&GenerateOptions {
            colors: o.colors,
            bottles: o.bottles,
            capacity: o.capacity,
            seed: o.seed,
            min_par: o.min_par,
            par_mode: if o.par_mode == "optimal" {
                ParMode::Optimal
            } else {
                ParMode::Proxy
            },
        })
        .unwrap_or_else(|e| panic!("{tag}: generation failed: {e}"));

        let expected_state = state_of(&case.state, o.capacity);
        assert_eq!(
            level.state, expected_state,
            "{tag}: generated board differs"
        );
        let expected_solution = moves_of(&case.solution);
        assert_eq!(
            level.solution, expected_solution,
            "{tag}: DFS solution differs"
        );
        assert_eq!(level.par, case.par, "{tag}: par differs");
        assert_eq!(level.min_moves, case.min_moves, "{tag}: minMoves differs");

        let state = &level.state;
        let solution = &level.solution;

        assert_eq!(
            bfs_optimal(state, None, DEFAULT_MAX_NODES),
            case.bfs_optimal,
            "{tag}: bfsOptimal differs"
        );

        // Mechanic overlays: draw-for-draw RNG alignment.
        let hidden = compute_hidden(
            state,
            o.seed,
            &exposable_cells(state, solution),
            HIDDEN_PROB,
        );
        assert_eq!(hidden, case.hidden, "{tag}: hidden grid differs");
        assert_eq!(
            capped_solve_moves(state, solution, &hidden),
            case.capped_solve_moves,
            "{tag}: cappedSolveMoves differs"
        );

        let funnels = compute_funnels(state, o.seed, &eligible_tubes(state, solution), FUNNEL_PROB);
        let expected_funnels: Vec<u8> =
            case.funnels.iter().map(|f| f.unwrap_or(NO_COLOR)).collect();
        assert_eq!(funnels, expected_funnels, "{tag}: funnels differ");

        let ice = build_ice(state, solution, &hidden, o.seed, ICE_PROB);
        let expected_ice: Vec<IceTube> = case
            .ice
            .iter()
            .map(|t| match t.trigger {
                None => IceTube::NONE,
                Some(trigger) => IceTube {
                    trigger,
                    height: t.height,
                },
            })
            .collect();
        assert_eq!(ice, expected_ice, "{tag}: ice differs");

        // Capped searches, including budget-exhaustion parity (None must match null).
        let overlays = Overlays {
            funnels: Some(&funnels),
            ice: Some(&ice),
        };
        assert_eq!(
            optimal_capped_moves(state, &hidden, case.capped_budget, overlays),
            case.optimal_capped,
            "{tag}: optimalCappedMoves differs"
        );
        let cutoffs = near_optimal_cutoffs(state, &hidden, case.cutoff_budget, overlays);
        assert_eq!(
            cutoffs.as_ref().map(|c| (c.optimal, c.two_star_max)),
            case.cutoffs.as_ref().map(|c| (c.optimal, c.two_star_max)),
            "{tag}: nearOptimalCutoffs differs"
        );
        assert_eq!(
            hint_move(state, &hidden, overlays, case.hint_budget),
            case.hint,
            "{tag}: hintMove differs"
        );

        // G2 seed: replay the solution, asserting each step's useful-move set (exact order —
        // both sides enumerate from-asc × to-asc) and the sampled boards.
        let mut cur = state.clone();
        for step in &case.trace {
            if let Some(cells) = &step.cells {
                assert_eq!(
                    cur,
                    state_of(cells, o.capacity),
                    "{tag}: trace board differs at step {}",
                    step.step
                );
            }
            assert_eq!(
                useful_moves(&cur, Some(&funnels)),
                step.useful_moves,
                "{tag}: useful-move set differs at step {}",
                step.step
            );
            let m = &solution[step.step];
            cur = pour(&cur, m.from as usize, m.to as usize, usize::MAX).0;
        }
        assert_eq!(
            cur,
            state_of(&case.final_cells, o.capacity),
            "{tag}: final board differs"
        );
    }
}
