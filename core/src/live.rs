//! Live-generation selection — port of `levelLoader.ts`'s `pickBest` + `cutoffsFor` (Track
//! F3): the coarse-to-fine best-of-N loop behind the endless tail, Play Random, and the daily
//! challenge. The plan (footprint, seed, mechanics, density) and the curve `target` are
//! INPUTS — notably the target, so `pow` never runs here and JS↔wasm board identity is exact
//! (the daily's cross-device determinism actually improves: this whole loop is fixed-order
//! float arithmetic). The tunable budget (`LiveConfig`) stays a parameter, so re-tuning the
//! live path is a JS-side change, same as today.

use crate::difficulty::{assign_slots, composite_scores, measure_metrics, MetricOptions, Metrics, Slotable};
use crate::generator::{generate_candidates, GeneratedLevel, DEFAULT_CAPACITY};
use crate::hidden::capped_solve_moves;
use crate::jsnum::js_round;
use crate::mechanics::{build_overlays, OverlaySet};
use crate::progression::{seed_for_level, Mechanic, MechanicDensity};
use crate::search::{near_optimal_cutoffs, optimal_capped_moves, Overlays};

/// `LiveGenConfig` — the coarse pool size, fine finalists, and fine dead-end samples.
#[derive(Clone, Copy, Debug)]
pub struct LiveConfig {
    pub pool_size: usize,
    pub finalists: usize,
    pub fine_dead_end_samples: usize,
}

/// The plan fields the selection loop consumes (a `LevelPlan` minus the JS-side display
/// metadata). `level` feeds the salt-retry seeds, exactly like JS.
#[derive(Clone, Debug)]
pub struct LivePlan {
    pub level: usize,
    pub colors: usize,
    pub bottles: usize,
    pub capacity: u8,
    pub seed: u32,
    pub mechanics: Vec<Mechanic>,
    pub density: MechanicDensity,
}

/// A chosen live board with everything `toPlayable` needs, plus the provenance measurements.
pub struct LivePick {
    pub level: GeneratedLevel,
    pub overlays: OverlaySet,
    pub optimal: u32,
    pub two_star_max: u32,
    pub score: f64,
    pub metrics: Metrics,
}

/// Largest standard-height board that gets the exact optimal at load time
/// (`EXACT_OPTIMAL_MAX_BOTTLES`).
const EXACT_OPTIMAL_MAX_BOTTLES: usize = 8;
/// JS `optimalCappedMoves` / `nearOptimalCutoffs` runtime DEFAULT budgets (search.ts).
const RUNTIME_OPTIMAL_BUDGET: usize = 12_000;
const RUNTIME_TIER_BUDGET: usize = 200_000;

/// Coarse scoring: proxy optimal, no dead-end sampling (`CHEAP_METRICS`).
const CHEAP_METRICS: MetricOptions = MetricOptions {
    optimal_node_budget: 0,
    tier_node_budget: 0,
    dead_end_samples: 0,
    dead_end_node_budget: 50_000,
    dead_end_seed: 1,
};

/// Score at percentile `p` (`percentileScore` — JS `Math.round` semantics).
fn percentile_score(scores: &[f64], p: f64) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }
    let mut sorted = scores.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let raw = js_round(p * (sorted.len() - 1) as f64);
    sorted[(raw.max(0.0) as usize).min(sorted.len() - 1)]
}

/// The live star cutoffs (`cutoffsFor`): exact A* + tier sweep on small standard boards,
/// capped-replay proxy + `+2` band elsewhere.
fn cutoffs_for(level: &GeneratedLevel, overlays: &OverlaySet) -> (u32, u32) {
    let stat = Overlays { funnels: Some(&overlays.funnels), ice: Some(&overlays.ice) };
    let small = level.bottles <= EXACT_OPTIMAL_MAX_BOTTLES && level.capacity <= DEFAULT_CAPACITY;
    let optimal = if small {
        optimal_capped_moves(&level.state, &overlays.hidden, RUNTIME_OPTIMAL_BUDGET, stat)
    } else {
        None
    }
    .unwrap_or_else(|| capped_solve_moves(&level.state, &level.solution, &overlays.hidden) as u32);
    if small {
        if let Some(tiers) = near_optimal_cutoffs(&level.state, &overlays.hidden, RUNTIME_TIER_BUDGET, stat) {
            if tiers.optimal == optimal {
                return (optimal, tiers.two_star_max);
            }
        }
    }
    (optimal, optimal + 2)
}

/// Coarse-to-fine best-of-N — port of `pickBest`, draw-for-draw and sort-for-sort (stable
/// finalist ordering, single-slot assignment). `None` when every salted pool comes up empty
/// (the JS side then falls back to its light generator).
pub fn pick_best(plan: &LivePlan, target: f64, config: &LiveConfig) -> Option<LivePick> {
    for salt in 0..8u32 {
        let pool_seed = if salt == 0 { plan.seed } else { seed_for_level(plan.level, salt) };
        let candidates = generate_candidates(
            plan.colors,
            plan.bottles,
            plan.capacity,
            pool_seed,
            config.pool_size,
            config.pool_size * 40,
        )
        .ok()?;
        if candidates.is_empty() {
            continue;
        }

        // Overlays per candidate — the overlay seed is the PLAN seed for every candidate,
        // mirroring `overlaysFor`.
        let built: Vec<(GeneratedLevel, OverlaySet)> = candidates
            .into_iter()
            .map(|g| {
                let overlays = build_overlays(&plan.mechanics, &g.state, &g.solution, plan.seed, plan.density);
                (g, overlays)
            })
            .collect();

        // Coarse pass: cheap-score the pool, keep the finalists nearest the curve target.
        let coarse_metrics: Vec<Metrics> = built
            .iter()
            .map(|(g, o)| {
                let stat = Overlays { funnels: Some(&o.funnels), ice: Some(&o.ice) };
                measure_metrics(&g.state, &o.hidden, &g.solution, &CHEAP_METRICS, stat)
            })
            .collect();
        let coarse = composite_scores(&coarse_metrics);
        let coarse_target = percentile_score(&coarse, target);
        let mut order: Vec<usize> = (0..built.len()).collect();
        // JS sorts {b, dist} by dist with a STABLE sort; sort_by is stable, ties keep pool order.
        order.sort_by(|&a, &b| {
            let da = (coarse[a] - coarse_target).abs();
            let db = (coarse[b] - coarse_target).abs();
            da.partial_cmp(&db).unwrap()
        });
        order.truncate(config.finalists.min(built.len()));

        // Fine pass: dead-end sampling on the finalists, then the single-slot assignment.
        let fine_opts = MetricOptions {
            optimal_node_budget: 0,
            tier_node_budget: 0,
            dead_end_samples: config.fine_dead_end_samples,
            dead_end_node_budget: 12_000,
            dead_end_seed: 1,
        };
        let fine_measured: Vec<Metrics> = order
            .iter()
            .map(|&i| {
                let (g, o) = &built[i];
                let stat = Overlays { funnels: Some(&o.funnels), ice: Some(&o.ice) };
                measure_metrics(&g.state, &o.hidden, &g.solution, &fine_opts, stat)
            })
            .collect();
        let fine = composite_scores(&fine_measured);
        let slotables: Vec<Slotable> = fine.iter().map(|&score| Slotable { score, family: "live" }).collect();
        let idx = assign_slots(&slotables, &[target])[0];

        let (level, overlays) = built[order[idx]].clone();
        let (optimal, two_star_max) = cutoffs_for(&level, &overlays);
        return Some(LivePick {
            level,
            overlays,
            optimal,
            two_star_max,
            score: fine[idx],
            metrics: fine_measured[idx].clone(),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{is_won, pour};
    use crate::progression::balanced_density;

    #[test]
    fn picks_a_solvable_board_deterministically() {
        let plan = LivePlan {
            level: 0,
            colors: 4,
            bottles: 5,
            capacity: 4,
            seed: 4242,
            mechanics: vec![Mechanic::Hidden, Mechanic::Funnel, Mechanic::Ice],
            density: balanced_density(),
        };
        let config = LiveConfig { pool_size: 24, finalists: 6, fine_dead_end_samples: 6 };
        let a = pick_best(&plan, 0.7, &config).expect("pick");
        let b = pick_best(&plan, 0.7, &config).expect("pick");
        assert_eq!(a.level.state, b.level.state);
        assert_eq!(a.score, b.score);
        assert!(a.two_star_max > a.optimal);

        // The stored solution wins the board.
        let mut cur = a.level.state.clone();
        for m in &a.level.solution {
            cur = pour(&cur, m.from as usize, m.to as usize, usize::MAX).0;
        }
        assert!(is_won(&cur));
    }
}
