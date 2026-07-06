//! Native bake CLI — port of `scripts/build-levels.ts` (PLAN.md F2). Generates + measures a
//! candidate pool per (chapter, shape) in parallel (rayon), scores each chapter's pool,
//! assigns boards to curve slots, and writes JSON to a SCRATCH directory — never the
//! committed data (a JS emitter turns accepted output into `levels.data.ts` at cutover, F4).
//!
//! Output files (in --out):
//!   levels.json       BakedLevel-shaped boards (palette-id strings, ready for the JS emitter)
//!   provenance.json   same shape as scripts/levels.provenance.json (report-app comparable)
//!   golden-lines.json per-level optimal winning line (feeds gate G3)
//!
//! Usage: bake [--out DIR] [--chapter N | --level N] [count perShape nodeBudget deadEndSamples]
//! The --chapter/--level slice flags are the absorbed E5 fast path (a chapter is the atomic
//! unit — scoring percentiles need the whole chapter pool).

use std::collections::HashSet;
use std::time::Instant;

use rayon::prelude::*;
use serde::Serialize;

use magic_color_core::difficulty::{
    assign_slots, composite_scores, measure_metrics, MetricOptions, Metrics, Slotable,
    OPTIMAL_NODE_BUDGET,
};
use magic_color_core::generator::{generate_candidates, GeneratedLevel};
use magic_color_core::mechanics::{build_overlays, presence_ok, OverlaySet};
use magic_color_core::progression::{
    campaign_density, chapter_for_level, phase_for_level, seed_for_level, target_percentile,
    Mechanic, CAMPAIGN_LENGTH, CHAPTER_LEN, MECHANIC_SETS, SHAPES,
};
use magic_color_core::search::{optimal_capped_line, Overlays};
use magic_color_core::state::State;
use magic_color_core::types::{color_index, color_name, NO_COLOR};
use magic_color_core::CORE_VERSION;

const DEFAULT_PER_SHAPE: usize = 80;
const DEFAULT_NODE_BUDGET: usize = 150_000;
const DEFAULT_DEAD_END_SAMPLES: usize = 24;
/// Node budget for the golden-line A* — generous: it runs once per SELECTED level (240×),
/// not per candidate, and G3 needs the line whenever the optimal was exact.
const GOLDEN_LINE_BUDGET: usize = 2_000_000;

struct Candidate {
    level: GeneratedLevel,
    overlays: OverlaySet,
    metrics: Metrics,
    family: &'static str,
    bottles: usize,
    capacity: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BakedLevelOut {
    level: usize,
    bottles: Vec<Vec<&'static str>>,
    capacity: u8,
    hidden: Vec<Vec<bool>>,
    funnels: Vec<Option<&'static str>>,
    ice: Vec<Vec<Option<&'static str>>>,
    optimal: u32,
    two_star_max: u32,
    par: u32,
    phase: &'static str,
    mechanics: Vec<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricsOut {
    optimal: u32,
    optimal_exact: bool,
    two_star_max: u32,
    forced_move_ratio: f64,
    dead_end_density: f64,
    dig_depth: f64,
    funnel_load: f64,
    ice_load: f64,
    colors: usize,
    empties: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceOut {
    level: usize,
    chapter: usize,
    phase: &'static str,
    family: &'static str,
    footprint: String,
    target_percentile: f64,
    score: f64,
    metrics: MetricsOut,
}

/// Typed wrapper for provenance.json — a struct (not `serde_json::json!`) so key order stays
/// declaration order; the `json!` Value map alphabetizes, which churned the committed
/// provenance diff at cutover.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceFile {
    version: String,
    count: usize,
    per_shape: usize,
    levels: Vec<ProvenanceOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoldenLineOut {
    level: usize,
    /// `None` when the level's optimal is a proxy (A* overflowed) — G3 skips those.
    line: Option<Vec<(u8, u8)>>,
}

/// Content hash of the crate sources (FNV-1a 64, hex) — the Rust analogue of
/// `currentGeneratorVersion()`: names this bake's provenance in `scripts/build-history/` so
/// distinct crate versions never collide, and seeds the G5 freshness check. Compile-time
/// `CARGO_MANIFEST_DIR` is fine here — the bake is a dev-machine tool run from the repo.
fn crate_source_hash() -> String {
    const MANIFEST: &str = env!("CARGO_MANIFEST_DIR");
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(format!("{MANIFEST}/src"))
        .expect("read core/src")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "rs"))
        .collect();
    files.sort();
    files.push(format!("{MANIFEST}/src/bin/bake.rs").into());
    files.push(format!("{MANIFEST}/Cargo.toml").into());

    let mut h: u64 = 0xcbf29ce484222325;
    for f in files {
        for b in std::fs::read(&f).expect("read crate source") {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{h:016x}")
}

fn mechanic_name(m: Mechanic) -> &'static str {
    match m {
        Mechanic::Hidden => "hidden",
        Mechanic::Funnel => "funnel",
        Mechanic::Ice => "ice",
    }
}


/// JS `Number(x.toFixed(3))` for the provenance display fields.
fn to_fixed3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("bake {CORE_VERSION}");
        return;
    }

    let mut out_dir = String::from("bake-out");
    let mut only_chapter: Option<usize> = None;
    let mut only_level: Option<usize> = None;
    let mut positional: Vec<String> = Vec::new();
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--out" => out_dir = it.next().expect("--out needs a directory"),
            "--chapter" => only_chapter = Some(it.next().expect("--chapter needs N").parse().unwrap()),
            "--level" => only_level = Some(it.next().expect("--level needs N").parse().unwrap()),
            other => positional.push(other.to_string()),
        }
    }
    let count: usize = positional.first().map_or(CAMPAIGN_LENGTH, |s| s.parse().unwrap());
    let per_shape: usize = positional.get(1).map_or(DEFAULT_PER_SHAPE, |s| s.parse().unwrap());
    let node_budget: usize = positional.get(2).map_or(DEFAULT_NODE_BUDGET, |s| s.parse().unwrap());
    let dead_end_samples: usize =
        positional.get(3).map_or(DEFAULT_DEAD_END_SAMPLES, |s| s.parse().unwrap());

    if let Some(level) = only_level {
        only_chapter = Some(chapter_for_level(level));
    }
    let chapters: Vec<usize> = (0..)
        .take_while(|c| c * CHAPTER_LEN < count)
        .filter(|c| only_chapter.is_none_or(|oc| oc == *c))
        .collect();

    let wall = Instant::now();
    println!(
        "bake {CORE_VERSION}: {} chapter(s) × {} shapes, {per_shape}/shape, budget {node_budget}, {} dead-end samples",
        chapters.len(),
        SHAPES.len(),
        dead_end_samples,
    );

    // One job per (chapter, shape) — same seeding scheme as build-levels.worker.ts, so the
    // candidate STREAMS match the JS bake even though selection may differ (float scoring).
    let jobs: Vec<(usize, usize)> =
        chapters.iter().flat_map(|&c| (0..SHAPES.len()).map(move |si| (c, si))).collect();

    let pools: Vec<Vec<Candidate>> = jobs
        .par_iter()
        .map(|&(chapter, si)| {
            let shape = &SHAPES[si];
            let mechanics = MECHANIC_SETS[chapter];
            let density = campaign_density(chapter);
            let seed = seed_for_level(50_000 + chapter * 100 + si, 0);
            let candidates = generate_candidates(
                shape.colors,
                shape.bottles,
                shape.capacity,
                seed,
                per_shape,
                per_shape * 40,
            )
            .expect("valid shape");
            candidates
                .into_iter()
                .enumerate()
                .map(|(ci, level)| {
                    let tag = chapter * 1_000_000 + si * 10_000 + ci;
                    let overlays = build_overlays(
                        mechanics,
                        &level.state,
                        &level.solution,
                        seed_for_level(tag, 0),
                        density,
                    );
                    let metrics = measure_metrics(
                        &level.state,
                        &overlays.hidden,
                        &level.solution,
                        &MetricOptions {
                            optimal_node_budget: node_budget,
                            tier_node_budget: OPTIMAL_NODE_BUDGET,
                            dead_end_samples,
                            dead_end_node_budget: 50_000,
                            dead_end_seed: tag as u32,
                        },
                        Overlays { funnels: Some(&overlays.funnels), ice: Some(&overlays.ice) },
                    );
                    Candidate {
                        level,
                        overlays,
                        metrics,
                        family: shape.family.name(),
                        bottles: shape.bottles,
                        capacity: shape.capacity,
                    }
                })
                .collect()
        })
        .collect();

    let mut baked: Vec<BakedLevelOut> = Vec::new();
    let mut provenance: Vec<ProvenanceOut> = Vec::new();
    let mut golden: Vec<GoldenLineOut> = Vec::new();

    for &chapter in &chapters {
        let first_level = chapter * CHAPTER_LEN + 1;
        let last_level = ((chapter + 1) * CHAPTER_LEN).min(count);
        let levels: Vec<usize> = (first_level..=last_level).collect();
        let mechanics = MECHANIC_SETS[chapter];

        // Reassemble in (shape, candidate) order — identical to a serial bake.
        let mut pool: Vec<&Candidate> = Vec::new();
        for (ji, &(jc, _)) in jobs.iter().enumerate() {
            if jc == chapter {
                pool.extend(pools[ji].iter());
            }
        }
        let pool: Vec<&Candidate> =
            pool.into_iter().filter(|c| presence_ok(&c.overlays, mechanics)).collect();

        let scores = composite_scores(&pool.iter().map(|c| c.metrics.clone()).collect::<Vec<_>>());
        let targets: Vec<f64> = levels.iter().map(|&l| target_percentile(l)).collect();
        let slotables: Vec<Slotable> = pool
            .iter()
            .zip(&scores)
            .map(|(c, &score)| Slotable { score, family: c.family })
            .collect();
        let picks = assign_slots(&slotables, &targets);

        println!(
            "chapter {chapter} (levels {first_level}–{last_level}): pool {} after presence filter",
            pool.len()
        );

        for (s, &level_no) in levels.iter().enumerate() {
            if only_level.is_some_and(|ol| ol != level_no) {
                continue;
            }
            let chosen = pool[picks[s]];
            let score = scores[picks[s]];
            let state = &chosen.level.state;
            let m = &chosen.metrics;

            baked.push(BakedLevelOut {
                level: level_no,
                bottles: state
                    .tubes
                    .iter()
                    .map(|t| t.cells().iter().map(|&c| color_name(c)).collect())
                    .collect(),
                capacity: chosen.capacity,
                hidden: state
                    .tubes
                    .iter()
                    .enumerate()
                    .map(|(b, t)| (0..t.len()).map(|i| chosen.overlays.hidden[b] & (1 << i) != 0).collect())
                    .collect(),
                funnels: chosen
                    .overlays
                    .funnels
                    .iter()
                    .map(|&f| if f == NO_COLOR { None } else { Some(color_name(f)) })
                    .collect(),
                ice: state
                    .tubes
                    .iter()
                    .enumerate()
                    .map(|(b, t)| {
                        let it = chosen.overlays.ice[b];
                        (0..t.len())
                            .map(|i| {
                                if it.trigger != NO_COLOR && i < it.height as usize {
                                    Some(color_name(it.trigger))
                                } else {
                                    None
                                }
                            })
                            .collect()
                    })
                    .collect(),
                optimal: m.optimal,
                two_star_max: m.two_star_max,
                par: chosen.level.par,
                phase: phase_for_level(level_no).name(),
                mechanics: mechanics.iter().map(|&mm| mechanic_name(mm)).collect(),
            });
            provenance.push(ProvenanceOut {
                level: level_no,
                chapter,
                phase: phase_for_level(level_no).name(),
                family: chosen.family,
                footprint: format!("{}c/{}b×{}", m.colors, chosen.bottles, chosen.capacity),
                target_percentile: to_fixed3(targets[s]),
                score: to_fixed3(score),
                metrics: MetricsOut {
                    optimal: m.optimal,
                    optimal_exact: m.optimal_exact,
                    two_star_max: m.two_star_max,
                    forced_move_ratio: m.forced_move_ratio,
                    dead_end_density: m.dead_end_density,
                    dig_depth: m.dig_depth,
                    funnel_load: m.funnel_load,
                    ice_load: m.ice_load,
                    colors: m.colors,
                    empties: m.empties,
                },
            });
            // Golden optimal line (G3) — only meaningful when the optimal was exact.
            let line = if m.optimal_exact {
                optimal_capped_line(
                    state,
                    &chosen.overlays.hidden,
                    GOLDEN_LINE_BUDGET,
                    Overlays { funnels: Some(&chosen.overlays.funnels), ice: Some(&chosen.overlays.ice) },
                )
            } else {
                None
            };
            if let Some(l) = &line {
                assert_eq!(l.len() as u32, m.optimal, "golden line length != optimal (L{level_no})");
            }
            golden.push(GoldenLineOut { level: level_no, line });
        }
    }

    // Distinct-board sanity within this run (mirrors generateCandidates' per-pool dedupe).
    let mut seen: HashSet<Vec<u128>> = HashSet::new();
    for b in &baked {
        let tubes = b
            .bottles
            .iter()
            .map(|col| {
                magic_color_core::state::Tube::from_cells(
                    &col.iter().map(|c| color_index(c).unwrap()).collect::<Vec<_>>(),
                )
            })
            .collect();
        let key = magic_color_core::state::state_key(&State { tubes, capacity: b.capacity }, None);
        if !seen.insert(key) {
            println!("warning: duplicate board at L{}", b.level);
        }
    }

    std::fs::create_dir_all(&out_dir).expect("create --out dir");
    let write = |name: &str, json: String| {
        let path = format!("{out_dir}/{name}");
        std::fs::write(&path, json + "\n").expect("write output");
        println!("wrote {path}");
    };
    let version = format!("rust-{}", crate_source_hash());
    write("levels.json", serde_json::to_string_pretty(&baked).unwrap());
    write(
        "provenance.json",
        serde_json::to_string_pretty(&ProvenanceFile {
            version,
            count: baked.len(),
            per_shape,
            levels: provenance,
        })
        .unwrap(),
    );
    write("golden-lines.json", serde_json::to_string_pretty(&golden).unwrap());

    println!("baked {} level(s) in {:.1}s", baked.len(), wall.elapsed().as_secs_f64());
}
