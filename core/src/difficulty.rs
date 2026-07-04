//! Offline difficulty metrics, composite scoring, and slot assignment — port of
//! `src/game/difficulty.ts`. All arithmetic is basic IEEE ops replayed in the exact JS
//! operation order, so metrics and scores are bit-identical cross-language (pinned by the
//! difficulty vectors); nothing here goes through `pow`.

use crate::engine::{is_won, pour};
use crate::funnels::funnel_load;
use crate::hidden::capped_solve_moves;
use crate::ice::ice_load;
use crate::jsnum::js_round;
use crate::rng::Mulberry32;
use crate::search::{near_optimal_cutoffs, optimal_capped_moves, Overlays};
use crate::solver::{is_unsolvable, useful_moves};
use crate::state::{Hidden, State};
use crate::types::Move;

/// Offline node budget for the exact-optimal A* (`OPTIMAL_NODE_BUDGET`).
pub const OPTIMAL_NODE_BUDGET: usize = 200_000;

#[derive(Clone, Debug, PartialEq)]
pub struct Metrics {
    pub optimal: u32,
    pub optimal_exact: bool,
    pub two_star_max: u32,
    pub forced_move_ratio: f64,
    pub dead_end_density: f64,
    pub dig_depth: f64,
    pub funnel_load: f64,
    pub ice_load: f64,
    /// Distinct colors on the board.
    pub colors: usize,
    /// Spare tubes (`bottles - colors`).
    pub empties: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct MetricOptions {
    pub optimal_node_budget: usize,
    /// Budget for the tier sweep; 0 disables it (twoStarMax falls back to `optimal + 2`).
    pub tier_node_budget: usize,
    pub dead_end_samples: usize,
    pub dead_end_node_budget: usize,
    pub dead_end_seed: u32,
}

impl Default for MetricOptions {
    fn default() -> Self {
        MetricOptions {
            optimal_node_budget: OPTIMAL_NODE_BUDGET,
            tier_node_budget: OPTIMAL_NODE_BUDGET,
            dead_end_samples: 24,
            dead_end_node_budget: 50_000,
            dead_end_seed: 1,
        }
    }
}

/// Fraction of solution-path states with ≤1 useful move.
fn forced_move_ratio(state: &State, solution: &[Move], overlays: Overlays) -> f64 {
    let mut current = state.clone();
    let mut forced = 0usize;
    let mut total = 0usize;
    for m in solution {
        if useful_moves(&current, overlays.funnels).len() <= 1 {
            forced += 1;
        }
        total += 1;
        current = pour(&current, m.from as usize, m.to as usize, usize::MAX).0;
    }
    if total == 0 { 1.0 } else { forced as f64 / total as f64 }
}

/// Fraction of random useful-move playouts that land in a provably unsolvable state.
fn dead_end_density(
    state: &State,
    solution_len: usize,
    samples: usize,
    node_budget: usize,
    seed: u32,
    overlays: Overlays,
) -> f64 {
    if samples == 0 {
        return 0.0;
    }
    let mut rng = Mulberry32::new(seed);
    let steps = (js_round(solution_len as f64 * 0.4) as usize).max(2);

    let mut dead = 0usize;
    for _ in 0..samples {
        let mut current = state.clone();
        for _ in 0..steps {
            let moves = useful_moves(&current, overlays.funnels);
            if moves.is_empty() {
                break;
            }
            let (from, to) = moves[(rng.next_f64() * moves.len() as f64).floor() as usize];
            current = pour(&current, from as usize, to as usize, usize::MAX).0;
            if is_won(&current) {
                break;
            }
        }
        if !is_won(&current) && is_unsolvable(&current, overlays.funnels, node_budget) {
            dead += 1;
        }
    }
    dead as f64 / samples as f64
}

/// Concealment burden: liquid stacked on (and including) each "?", size-normalized.
/// Accumulation order matches the JS loops exactly (float sums are order-sensitive).
pub fn dig_depth(state: &State, hidden: &Hidden) -> f64 {
    let cap = state.capacity as f64;
    let mut total = 0usize;
    let mut sum = 0.0f64;
    for (b, t) in state.tubes.iter().enumerate() {
        total += t.len();
        for i in 0..t.len() {
            if hidden[b] & (1 << i) != 0 {
                sum += (t.len() - i) as f64 / cap;
            }
        }
    }
    if total == 0 { 0.0 } else { sum / total as f64 }
}

/// Distinct colors on the board.
fn distinct_colors(state: &State) -> usize {
    let mut mask: u16 = 0;
    for t in &state.tubes {
        for i in 0..t.len() {
            mask |= 1 << t.cell(i);
        }
    }
    mask.count_ones() as usize
}

/// Measure a candidate's difficulty metrics — port of `measureMetrics` (same fallbacks,
/// same tier-trust rule).
pub fn measure_metrics(
    state: &State,
    hidden: &Hidden,
    solution: &[Move],
    opts: &MetricOptions,
    overlays: Overlays,
) -> Metrics {
    let colors = distinct_colors(state);
    let exact = optimal_capped_moves(state, hidden, opts.optimal_node_budget, overlays);
    let optimal = exact.unwrap_or_else(|| capped_solve_moves(state, solution, hidden) as u32);
    let tiers = if opts.tier_node_budget > 0 {
        near_optimal_cutoffs(state, hidden, opts.tier_node_budget, overlays)
    } else {
        None
    };
    let two_star_max = match &tiers {
        Some(t) if t.optimal == optimal => t.two_star_max,
        _ => optimal + 2,
    };
    Metrics {
        optimal,
        optimal_exact: exact.is_some(),
        two_star_max,
        forced_move_ratio: forced_move_ratio(state, solution, overlays),
        dead_end_density: dead_end_density(
            state,
            solution.len(),
            opts.dead_end_samples,
            opts.dead_end_node_budget,
            opts.dead_end_seed,
            overlays,
        ),
        dig_depth: dig_depth(state, hidden),
        funnel_load: overlays.funnels.map_or(0.0, |f| funnel_load(f, colors)),
        ice_load: overlays.ice.map_or(0.0, |ice| ice_load(ice, state)),
        colors,
        empties: state.tubes.len() - colors,
    }
}

/// `SCORE_WEIGHTS` — shared constants, G5-checked.
pub const W_DEAD_END: f64 = 1.5;
pub const W_FORCED: f64 = 1.0;
pub const W_MOVES_PER_COLOR: f64 = 1.0;
pub const W_TIGHTNESS: f64 = 0.6;
pub const W_DIG_DEPTH: f64 = 1.0;
pub const W_FUNNEL_LOAD: f64 = 1.0;
pub const W_ICE_LOAD: f64 = 1.0;

/// Size-normalized composite scores for a pool — port of `compositeScores`, including the
/// pool-gated funnel/ice weights and the exact weighted-sum term order.
pub fn composite_scores(pool: &[Metrics]) -> Vec<f64> {
    if pool.is_empty() {
        return Vec::new();
    }
    let moves_per_color: Vec<f64> =
        pool.iter().map(|m| if m.colors > 0 { m.optimal as f64 / m.colors as f64 } else { 0.0 }).collect();
    let lo = moves_per_color.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = moves_per_color.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let norm_mpc = |x: f64| if hi > lo { (x - lo) / (hi - lo) } else { 0.5 };

    let w_funnel = if pool.iter().any(|m| m.funnel_load > 0.0) { W_FUNNEL_LOAD } else { 0.0 };
    let w_ice = if pool.iter().any(|m| m.ice_load > 0.0) { W_ICE_LOAD } else { 0.0 };
    let w_sum = W_DEAD_END + W_FORCED + W_MOVES_PER_COLOR + W_TIGHTNESS + W_DIG_DEPTH + w_funnel + w_ice;

    pool.iter()
        .enumerate()
        .map(|(i, m)| {
            let tightness = if m.colors > 0 {
                (1.0 - m.empties as f64 / m.colors as f64).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let weighted = W_DEAD_END * m.dead_end_density
                + W_FORCED * (1.0 - m.forced_move_ratio)
                + W_MOVES_PER_COLOR * norm_mpc(moves_per_color[i])
                + W_TIGHTNESS * tightness
                + W_DIG_DEPTH * m.dig_depth
                + w_funnel * m.funnel_load
                + w_ice * m.ice_load;
            weighted / w_sum
        })
        .collect()
}

/// A candidate as far as slot assignment cares.
pub struct Slotable<'a> {
    pub score: f64,
    pub family: &'a str,
}

const ROTATION_PENALTY: f64 = 0.05;

fn quantile(sorted_asc: &[f64], p: f64) -> f64 {
    if sorted_asc.is_empty() {
        return 0.0;
    }
    let raw = js_round(p * (sorted_asc.len() - 1) as f64);
    let i = (raw.max(0.0) as usize).min(sorted_asc.len() - 1);
    sorted_asc[i]
}

/// Assign one candidate per curve slot — port of `assignSlots` (closest-to-target with
/// family-rotation penalty and relaxable monotonicity). Same scan order, so ties pick the
/// same index.
pub fn assign_slots(pool: &[Slotable], target_percentiles: &[f64]) -> Vec<usize> {
    assert!(
        pool.len() >= target_percentiles.len(),
        "assignSlots: pool ({}) smaller than slots ({})",
        pool.len(),
        target_percentiles.len()
    );
    let mut sorted_scores: Vec<f64> = pool.iter().map(|p| p.score).collect();
    sorted_scores.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let mut used = vec![false; pool.len()];
    let mut prev_score = f64::NEG_INFINITY;
    let mut prev_family: Option<&str> = None;
    let mut result = Vec::with_capacity(target_percentiles.len());

    for &pct in target_percentiles {
        let target = quantile(&sorted_scores, pct);
        let pick = |require_monotonic: bool, used: &[bool]| -> Option<usize> {
            let mut best: Option<usize> = None;
            let mut best_cost = f64::INFINITY;
            for (i, cand) in pool.iter().enumerate() {
                if used[i] {
                    continue;
                }
                if require_monotonic && cand.score < prev_score {
                    continue;
                }
                let mut cost = (cand.score - target).abs();
                if prev_family.is_some_and(|f| f == cand.family) {
                    cost += ROTATION_PENALTY;
                }
                if cost < best_cost {
                    best_cost = cost;
                    best = Some(i);
                }
            }
            best
        };

        let idx = pick(true, &used).or_else(|| pick(false, &used)).unwrap();
        used[idx] = true;
        result.push(idx);
        prev_score = pool[idx].score;
        prev_family = Some(pool[idx].family);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(score_ish: f64) -> Metrics {
        Metrics {
            optimal: 10,
            optimal_exact: true,
            two_star_max: 12,
            forced_move_ratio: 1.0 - score_ish,
            dead_end_density: score_ish,
            dig_depth: 0.0,
            funnel_load: 0.0,
            ice_load: 0.0,
            colors: 4,
            empties: 1,
        }
    }

    #[test]
    fn scores_rank_harder_metrics_higher() {
        let pool = vec![m(0.1), m(0.9)];
        let scores = composite_scores(&pool);
        assert!(scores[1] > scores[0]);
    }

    #[test]
    fn slots_prefer_family_rotation_and_monotonicity() {
        let pool = vec![
            Slotable { score: 0.30, family: "small" },
            Slotable { score: 0.31, family: "small" },
            Slotable { score: 0.32, family: "tall" },
            Slotable { score: 0.70, family: "small" },
        ];
        let picks = assign_slots(&pool, &[0.0, 0.33, 1.0]);
        assert_eq!(picks.len(), 3);
        // Monotonic scores across slots.
        assert!(pool[picks[1]].score >= pool[picks[0]].score);
        assert!(pool[picks[2]].score >= pool[picks[1]].score);
        // Second pick rotates family off the first when the cost gap is within the penalty.
        assert_ne!(pool[picks[1]].family, pool[picks[0]].family);
    }
}
