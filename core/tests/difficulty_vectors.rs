//! Difficulty/progression pinning: replay `vectors/difficulty.json` (FROZEN golden vectors from
//! the retired JS implementation, captured at the port cutover).
//! Metrics, composite scores, and slot assignment are asserted BIT-EXACTLY (floats travel as
//! u64-bit strings); `targetPercentile` goes through `pow` (not correctly rounded in either
//! language) and is compared with tolerance.

use magic_color_core::difficulty::{
    assign_slots, composite_scores, measure_metrics, MetricOptions, Metrics, Slotable,
};
use magic_color_core::funnels::{compute_funnels, eligible_tubes, FUNNEL_PROB};
use magic_color_core::generator::{generate_level, GenerateOptions, ParMode};
use magic_color_core::hidden::{compute_hidden, exposable_cells, HIDDEN_PROB};
use magic_color_core::ice::{build_ice, ICE_PROB};
use magic_color_core::progression::{seed_for_level, target_percentile};
use magic_color_core::search::Overlays;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vectors {
    metric_options: JsMetricOptions,
    cases: Vec<Case>,
    composite_score_bits: Vec<String>,
    slot_targets: Vec<String>,
    slot_picks: Vec<usize>,
    seed_for_level: Vec<SeedCase>,
    target_percentile_bits: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsMetricOptions {
    optimal_node_budget: usize,
    tier_node_budget: usize,
    dead_end_samples: usize,
    dead_end_node_budget: usize,
}

#[derive(Deserialize)]
struct Case {
    seed: u32,
    metrics: JsMetrics,
    family: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsMetrics {
    optimal: u32,
    optimal_exact: bool,
    two_star_max: u32,
    forced_move_ratio_bits: String,
    dead_end_density_bits: String,
    dig_depth_bits: String,
    funnel_load_bits: String,
    ice_load_bits: String,
    colors: usize,
    empties: usize,
}

#[derive(Deserialize)]
struct SeedCase {
    level: usize,
    salt: u32,
    seed: u32,
}

fn f64_of(bits: &str) -> f64 {
    f64::from_bits(bits.parse::<u64>().unwrap())
}

/// The solver-vector footprints, in emitter order (same SOLVER_CASES table).
const FOOTPRINTS: [(usize, usize, u8, u32, Option<u32>, ParMode); 10] = [
    (3, 5, 4, 101, None, ParMode::Proxy),
    (4, 5, 4, 202, None, ParMode::Optimal),
    (4, 5, 4, 303, Some(12), ParMode::Proxy),
    (3, 5, 6, 404, None, ParMode::Proxy),
    (4, 5, 8, 505, None, ParMode::Proxy),
    (4, 5, 10, 606, None, ParMode::Proxy),
    (7, 10, 4, 707, None, ParMode::Proxy),
    (8, 10, 4, 808, Some(20), ParMode::Proxy),
    (11, 15, 4, 909, None, ParMode::Proxy),
    (12, 15, 4, 1010, None, ParMode::Proxy),
];

#[test]
fn difficulty_vectors_replay_exactly() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../vectors/difficulty.json");
    let raw = std::fs::read_to_string(path)
        .expect("vectors/difficulty.json missing — the committed golden vectors were deleted?");
    let vectors: Vectors = serde_json::from_str(&raw).unwrap();
    assert_eq!(vectors.cases.len(), FOOTPRINTS.len());

    let mut pool: Vec<Metrics> = Vec::new();
    for (case, &(colors, bottles, capacity, seed, min_par, par_mode)) in
        vectors.cases.iter().zip(&FOOTPRINTS)
    {
        assert_eq!(case.seed, seed, "vector/footprint order drifted");
        let level = generate_level(&GenerateOptions {
            colors,
            bottles,
            capacity,
            seed,
            min_par,
            par_mode,
        })
        .unwrap();
        let hidden = compute_hidden(
            &level.state,
            seed,
            &exposable_cells(&level.state, &level.solution),
            HIDDEN_PROB,
        );
        let funnels = compute_funnels(
            &level.state,
            seed,
            &eligible_tubes(&level.state, &level.solution),
            FUNNEL_PROB,
        );
        let ice = build_ice(&level.state, &level.solution, &hidden, seed, ICE_PROB);

        let o = &vectors.metric_options;
        let metrics = measure_metrics(
            &level.state,
            &hidden,
            &level.solution,
            &MetricOptions {
                optimal_node_budget: o.optimal_node_budget,
                tier_node_budget: o.tier_node_budget,
                dead_end_samples: o.dead_end_samples,
                dead_end_node_budget: o.dead_end_node_budget,
                dead_end_seed: seed,
            },
            Overlays {
                funnels: Some(&funnels),
                ice: Some(&ice),
            },
        );

        let e = &case.metrics;
        let tag = format!("seed {seed}");
        assert_eq!(metrics.optimal, e.optimal, "{tag}: optimal");
        assert_eq!(
            metrics.optimal_exact, e.optimal_exact,
            "{tag}: optimalExact"
        );
        assert_eq!(metrics.two_star_max, e.two_star_max, "{tag}: twoStarMax");
        assert_eq!(
            metrics.forced_move_ratio.to_bits(),
            f64_of(&e.forced_move_ratio_bits).to_bits(),
            "{tag}: forcedMoveRatio"
        );
        assert_eq!(
            metrics.dead_end_density.to_bits(),
            f64_of(&e.dead_end_density_bits).to_bits(),
            "{tag}: deadEndDensity"
        );
        assert_eq!(
            metrics.dig_depth.to_bits(),
            f64_of(&e.dig_depth_bits).to_bits(),
            "{tag}: digDepth"
        );
        assert_eq!(
            metrics.funnel_load.to_bits(),
            f64_of(&e.funnel_load_bits).to_bits(),
            "{tag}: funnelLoad"
        );
        assert_eq!(
            metrics.ice_load.to_bits(),
            f64_of(&e.ice_load_bits).to_bits(),
            "{tag}: iceLoad"
        );
        assert_eq!(metrics.colors, e.colors, "{tag}: colors");
        assert_eq!(metrics.empties, e.empties, "{tag}: empties");
        pool.push(metrics);
    }

    // Composite scores: bit-exact (fixed-order IEEE arithmetic on bit-exact inputs).
    let scores = composite_scores(&pool);
    for (i, (got, bits)) in scores.iter().zip(&vectors.composite_score_bits).enumerate() {
        assert_eq!(got.to_bits(), f64_of(bits).to_bits(), "composite score {i}");
    }

    // Slot assignment: identical picks on identical scores/targets.
    let slotables: Vec<Slotable> = scores
        .iter()
        .zip(&vectors.cases)
        .map(|(&score, c)| Slotable {
            score,
            family: &c.family,
        })
        .collect();
    let targets: Vec<f64> = vectors.slot_targets.iter().map(|b| f64_of(b)).collect();
    assert_eq!(
        assign_slots(&slotables, &targets),
        vectors.slot_picks,
        "slot picks"
    );

    // seedForLevel: exact integer hash.
    for s in &vectors.seed_for_level {
        assert_eq!(
            seed_for_level(s.level, s.salt),
            s.seed,
            "seedForLevel({}, {})",
            s.level,
            s.salt
        );
    }

    // targetPercentile: through pow ⇒ tolerance, not equality.
    for (i, bits) in vectors.target_percentile_bits.iter().enumerate() {
        let expected = f64_of(bits);
        let got = target_percentile(i + 1);
        assert!(
            (got - expected).abs() <= 1e-12,
            "targetPercentile({}) diverged: rust {got} vs js {expected}",
            i + 1
        );
    }
}
