//! Level generator — port of `src/game/generator.ts`. RNG draw order is preserved
//! draw-for-draw (fill profile, its rejection loop, both shuffles, one stream across all
//! attempts), and the solver explores the identical node sequence, so a seed produces the
//! *identical board and solution* as JS — the strongest single differential check in F1.

use std::collections::HashSet;

use crate::engine::{is_complete, is_won};
use crate::rng::Mulberry32;
use crate::solver::{bfs_optimal, canonical, solve, DEFAULT_MAX_NODES};
use crate::state::{Key, State, Tube};
use crate::types::Move;

pub const DEFAULT_CAPACITY: u8 = 4;
pub const MAX_COLORS: usize = 12; // palette size
const MAX_RETRIES: usize = 300;
const PAR_SAMPLE_CAP: usize = 50;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ParMode {
    Optimal,
    Proxy,
}

#[derive(Clone, Copy, Debug)]
pub struct GenerateOptions {
    pub colors: usize,
    pub bottles: usize,
    pub capacity: u8,
    pub seed: u32,
    /// Par floor for best-of-N rejection sampling; `None` = accept the first solvable board.
    pub min_par: Option<u32>,
    pub par_mode: ParMode,
}

#[derive(Clone, Debug)]
pub struct GeneratedLevel {
    pub state: State,
    pub colors: usize,
    pub bottles: usize,
    pub capacity: u8,
    pub solution: Vec<Move>,
    pub min_moves: usize,
    pub par: u32,
    pub seed: u32,
}

pub fn is_valid_combo(colors: usize, bottles: usize, capacity: u8) -> bool {
    if capacity < 2 {
        return false;
    }
    if !(2..=MAX_COLORS).contains(&colors) {
        return false;
    }
    bottles > colors // at least one empty tube
}

/// Fisher–Yates shuffle, one draw per swap from the back — identical to the JS helper.
fn shuffle<T>(arr: &mut [T], rng: &mut Mulberry32) {
    for i in (1..arr.len()).rev() {
        let j = (rng.next_f64() * (i + 1) as f64).floor() as usize;
        arr.swap(i, j);
    }
}

/// Randomized fill profile — port of `randomFillProfile`, including the reserved-empties
/// draw, the data-dependent sprinkle loop (a draw per iteration, applied only when the
/// picked tube can still shrink), and the final shuffle.
fn random_fill_profile(
    colors: usize,
    bottles: usize,
    capacity: u8,
    rng: &mut Mulberry32,
) -> Vec<usize> {
    let cap = capacity as usize;
    let empties = bottles - colors;
    let free_space = empties * cap;

    let reserved = (rng.next_f64() * (empties + 1) as f64).floor() as usize;

    let mut fills = vec![cap; bottles];
    for f in fills.iter_mut().take(reserved) {
        *f = 0;
    }

    let mut to_remove = free_space - reserved * cap;
    while to_remove > 0 {
        let i = reserved + (rng.next_f64() * (bottles - reserved) as f64).floor() as usize;
        if fills[i] > 1 {
            fills[i] -= 1;
            to_remove -= 1;
        }
    }

    shuffle(&mut fills, rng);
    fills
}

/// Deal a flat segment list into tubes sized by `fills`.
fn deal(segments: &[u8], fills: &[usize], capacity: u8) -> State {
    let mut tubes = Vec::with_capacity(fills.len());
    let mut offset = 0;
    for &fill in fills {
        tubes.push(Tube::from_cells(&segments[offset..offset + fill]));
        offset += fill;
    }
    State { tubes, capacity }
}

/// Already won, or a pre-completed color bottle.
fn is_degenerate(state: &State) -> bool {
    if is_won(state) {
        return true;
    }
    state
        .tubes
        .iter()
        .any(|t| !t.is_empty() && is_complete(t, state.capacity))
}

/// `capacity` copies of each of the first `colors` ids (ids ARE palette indices here).
fn color_template(colors: usize, capacity: u8) -> Vec<u8> {
    let mut template = Vec::with_capacity(colors * capacity as usize);
    for c in 0..colors as u8 {
        for _ in 0..capacity {
            template.push(c);
        }
    }
    template
}

fn measure_par(state: &State, solution: &[Move], mode: ParMode) -> u32 {
    if mode == ParMode::Optimal {
        if let Some(optimal) = bfs_optimal(state, None, DEFAULT_MAX_NODES) {
            return optimal as u32;
        }
    }
    solution.len() as u32
}

/// One generation attempt: profile, deal, degeneracy check, solve. RNG is consumed by the
/// profile + both shuffles BEFORE the degeneracy/solve rejection, so rejected attempts leave
/// the stream exactly where JS leaves it.
fn attempt_board(
    template: &[u8],
    colors: usize,
    bottles: usize,
    capacity: u8,
    rng: &mut Mulberry32,
) -> Option<(State, Vec<Move>)> {
    let fills = random_fill_profile(colors, bottles, capacity, rng);
    let mut segments = template.to_vec();
    shuffle(&mut segments, rng);
    let state = deal(&segments, &fills, capacity);
    if is_degenerate(&state) {
        return None;
    }
    let solution = solve(&state, None, DEFAULT_MAX_NODES)?;
    Some((state, solution))
}

/// Generate a verified-solvable level — port of `generateLevel` (legacy first-solvable path
/// and the best-of-N par-floor path).
pub fn generate_level(options: &GenerateOptions) -> Result<GeneratedLevel, String> {
    let GenerateOptions {
        colors,
        bottles,
        capacity,
        seed,
        min_par,
        par_mode,
    } = *options;
    if !is_valid_combo(colors, bottles, capacity) {
        return Err(format!(
            "invalid combo: {colors} colors / {bottles} bottles / cap {capacity}"
        ));
    }

    let mut rng = Mulberry32::new(seed);
    let template = color_template(colors, capacity);

    let build = |state: State, solution: Vec<Move>| -> GeneratedLevel {
        let par = measure_par(&state, &solution, par_mode);
        GeneratedLevel {
            min_moves: solution.len(),
            par,
            state,
            colors,
            bottles,
            capacity,
            solution,
            seed,
        }
    };

    let mut best: Option<GeneratedLevel> = None;
    let mut solvable_seen = 0usize;

    for _ in 0..MAX_RETRIES {
        let Some((state, solution)) = attempt_board(&template, colors, bottles, capacity, &mut rng)
        else {
            continue;
        };

        if min_par.is_none() {
            return Ok(build(state, solution));
        }

        let candidate = build(state, solution);
        let is_better = best.as_ref().is_none_or(|b| candidate.par > b.par);
        if candidate.par >= min_par.unwrap() {
            return Ok(candidate);
        }
        if is_better {
            best = Some(candidate);
        }

        solvable_seen += 1;
        if solvable_seen >= PAR_SAMPLE_CAP {
            return Ok(best.unwrap());
        }
    }

    best.ok_or_else(|| {
        format!(
            "failed to generate a solvable {colors}/{bottles} level after {MAX_RETRIES} attempts"
        )
    })
}

/// Up to `count` distinct solvable boards for the bake's candidate pool — port of
/// `generateCandidates` (dedupe by canonical key; proxy par).
pub fn generate_candidates(
    colors: usize,
    bottles: usize,
    capacity: u8,
    seed: u32,
    count: usize,
    max_attempts: usize,
) -> Result<Vec<GeneratedLevel>, String> {
    if !is_valid_combo(colors, bottles, capacity) {
        return Err(format!(
            "invalid combo: {colors} colors / {bottles} bottles / cap {capacity}"
        ));
    }

    let mut rng = Mulberry32::new(seed);
    let template = color_template(colors, capacity);

    let mut seen: HashSet<Key> = HashSet::new();
    let mut candidates: Vec<GeneratedLevel> = Vec::new();
    for _ in 0..max_attempts {
        if candidates.len() >= count {
            break;
        }
        let Some((state, solution)) = attempt_board(&template, colors, bottles, capacity, &mut rng)
        else {
            continue;
        };
        if !seen.insert(canonical(&state)) {
            continue;
        }
        candidates.push(GeneratedLevel {
            min_moves: solution.len(),
            par: solution.len() as u32,
            state,
            colors,
            bottles,
            capacity,
            solution,
            seed,
        });
    }
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::pour;

    #[test]
    fn generates_a_solvable_board_deterministically() {
        let opts = GenerateOptions {
            colors: 3,
            bottles: 5,
            capacity: 4,
            seed: 12345,
            min_par: None,
            par_mode: ParMode::Proxy,
        };
        let a = generate_level(&opts).unwrap();
        let b = generate_level(&opts).unwrap();
        assert_eq!(a.state, b.state);
        assert_eq!(a.solution, b.solution);

        // The stored solution actually wins.
        let mut cur = a.state.clone();
        for m in &a.solution {
            cur = pour(&cur, m.from as usize, m.to as usize, usize::MAX).0;
        }
        assert!(is_won(&cur));
    }

    #[test]
    fn candidates_are_distinct() {
        let out = generate_candidates(3, 5, 4, 999, 5, 200).unwrap();
        assert!(out.len() >= 2);
        let keys: HashSet<Key> = out.iter().map(|l| canonical(&l.state)).collect();
        assert_eq!(keys.len(), out.len());
    }
}
