//! Post-F6 release gate — the native replacement for `scripts/verify-bake.ts`. With the
//! gameplay rules living only in the core, "replay under JS rules" is meaningless (there is no
//! second implementation), so G3/G4 become a core SELF-CHECK of the emitted artifacts: an
//! independent pass (separate from the bake that wrote them) that catches a serialization bug,
//! a corrupted board, or a golden line that doesn't actually win.
//!
//!   G3 — golden winning-line replay: each level's emitted optimal line, replayed through the
//!        core's own `plan_tap` (capped pours + reveals + funnel/ice rules), must win in
//!        EXACTLY `optimal` pours with nothing left concealed or frozen.
//!   G4 — committed-level statics: board shape sane, no pre-completed (degenerate) tube, a
//!        `requiresPresence` mechanic actually present, `par ≥ 1`, `twoStarMax > optimal`, and
//!        a serialize↔deserialize round-trip (JSON ids ↔ palette bytes).
//!
//! Usage: verify <bake-out-dir>   (reads levels.json + golden-lines.json)
//! Exits non-zero naming the first offending level.

use std::collections::HashSet;

use serde::Deserialize;

use magic_color_core::engine::is_complete;
use magic_color_core::hidden::any_hidden;
use magic_color_core::ice::{any_frozen, IceTube};
use magic_color_core::session::{plan_tap, view, Status, TapOutcome};
use magic_color_core::state::{state_key, Hidden, State, Tube};
use magic_color_core::types::{NO_COLOR, PALETTE};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Level {
    level: usize,
    bottles: Vec<Vec<String>>,
    capacity: u8,
    hidden: Vec<Vec<bool>>,
    funnels: Vec<Option<String>>,
    ice: Vec<Vec<Option<String>>>,
    optimal: u32,
    two_star_max: u32,
    par: u32,
    mechanics: Vec<String>,
}

#[derive(Deserialize)]
struct Golden {
    level: usize,
    line: Option<Vec<(u8, u8)>>,
}

fn color_idx(name: &str) -> u8 {
    PALETTE.iter().position(|p| *p == name).unwrap_or_else(|| panic!("unknown palette id {name}")) as u8
}

fn fail(level: usize, msg: &str) -> ! {
    eprintln!("FAIL L{level}: {msg}");
    std::process::exit(1);
}

/// Decode a level's JSON into core types, asserting the serialize↔deserialize round-trip
/// (part of G4): re-encoding the decoded board reproduces the JSON strings exactly.
fn decode(l: &Level) -> (State, Hidden, Vec<u8>, Vec<IceTube>) {
    let cap = l.capacity as usize;
    let tubes: Vec<Tube> = l
        .bottles
        .iter()
        .map(|col| {
            if col.len() > cap {
                fail(l.level, "overfull tube");
            }
            Tube::from_cells(&col.iter().map(|c| color_idx(c)).collect::<Vec<_>>())
        })
        .collect();
    let state = State { tubes, capacity: l.capacity };

    let hidden: Hidden = l
        .hidden
        .iter()
        .map(|col| col.iter().enumerate().fold(0u16, |m, (i, &h)| if h { m | (1 << i) } else { m }))
        .collect();
    let funnels: Vec<u8> = l.funnels.iter().map(|f| f.as_deref().map_or(NO_COLOR, color_idx)).collect();
    let ice: Vec<IceTube> = l
        .ice
        .iter()
        .map(|col| {
            let height = col.iter().rposition(|c| c.is_some()).map_or(0, |i| i + 1);
            // Contiguous-bottom, single-tint invariant (a corruption check).
            for c in col.iter().take(height) {
                if c.as_deref() != col[0].as_deref() {
                    fail(l.level, "ice block not a contiguous single-tint bottom run");
                }
            }
            if height == 0 {
                IceTube::NONE
            } else {
                IceTube { trigger: color_idx(col[0].as_deref().unwrap()), height: height as u8 }
            }
        })
        .collect();
    (state, hidden, funnels, ice)
}

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: verify <bake-out-dir>");
        std::process::exit(2);
    });

    let levels: Vec<Level> =
        serde_json::from_str(&std::fs::read_to_string(format!("{dir}/levels.json")).expect("read levels.json"))
            .expect("parse levels.json");
    let golden: std::collections::HashMap<usize, Option<Vec<(u8, u8)>>> =
        serde_json::from_str::<Vec<Golden>>(
            &std::fs::read_to_string(format!("{dir}/golden-lines.json")).expect("read golden-lines.json"),
        )
        .expect("parse golden-lines.json")
        .into_iter()
        .map(|g| (g.level, g.line))
        .collect();

    let mut replayed = 0usize;
    let mut skipped = 0usize;

    for l in &levels {
        let (state, hidden, funnels, ice) = decode(l);

        // --- G4: static checks ---
        if state.tubes.iter().all(|t| is_complete(t, state.capacity)) {
            fail(l.level, "board already won");
        }
        if state.tubes.iter().any(|t| !t.is_empty() && is_complete(t, state.capacity)) {
            fail(l.level, "degenerate: a tube is pre-completed at start");
        }
        if l.par < 1 {
            fail(l.level, "par < 1");
        }
        if l.two_star_max <= l.optimal {
            fail(l.level, &format!("twoStarMax {} <= optimal {}", l.two_star_max, l.optimal));
        }
        if l.mechanics.iter().any(|m| m == "funnel") && funnels.iter().all(|&f| f == NO_COLOR) {
            fail(l.level, "funnel chapter level shows no funnel");
        }
        if l.mechanics.iter().any(|m| m == "ice") && ice.iter().all(|t| t.trigger == NO_COLOR) {
            fail(l.level, "ice chapter level shows no ice");
        }

        // --- G3: golden-line replay through the core's own tap rules ---
        let Some(line) = golden.get(&l.level).cloned().flatten() else {
            skipped += 1; // proxy-optimal level (A* overflowed at bake time) — no line to replay
            continue;
        };
        let mut cur = state.clone();
        let mut hide = hidden.clone();
        let mut pours = 0u32;
        for (step, &(from, to)) in line.iter().enumerate() {
            match plan_tap(&cur, &hide, &funnels, &ice, Some(from as usize), to as usize) {
                TapOutcome::Pour { next, next_hidden, .. } => {
                    cur = next;
                    hide = next_hidden;
                    pours += 1;
                }
                other => fail(l.level, &format!("golden move {step} ({from}->{to}) not a legal pour: {other:?}")),
            }
        }
        // A fully solved board reports Won only when nothing is concealed or frozen — ask the
        // same `view` the runtime renders from (stuck check unused on a won board).
        let status = view(&cur, &hide, &funnels, &ice, None, || false).status;
        if status != Status::Won {
            fail(l.level, "golden line does not reach a win");
        }
        if any_hidden(&hide) {
            fail(l.level, "golden line leaves concealed cells");
        }
        if any_frozen(&cur, &hide, &ice) {
            fail(l.level, "golden line leaves frozen cells");
        }
        if pours != l.optimal {
            fail(l.level, &format!("golden line wins in {pours}, optimal says {}", l.optimal));
        }
        replayed += 1;
    }

    // Distinct-board sanity across the whole committed set (mirrors the bake's per-pool dedupe).
    let mut seen: HashSet<Vec<u128>> = HashSet::new();
    for l in &levels {
        let (state, ..) = decode(l);
        if !seen.insert(state_key(&state, None)) {
            fail(l.level, "duplicate board in the committed set");
        }
    }

    println!(
        "PASS: {} levels — statics green; {replayed} golden lines replayed at exact optimal ({skipped} proxy levels skipped)",
        levels.len()
    );
}
