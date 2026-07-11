//! PRNG pinning: replay `vectors/rng.json` — FROZEN golden vectors from the JS implementation
//! this PRNG must match bit-for-bit — and require exact agreement on the raw u32 draws.
//! Divergence here would silently skew every seeded stream downstream. The vectors store u32,
//! not the JS-visible float: serde_json's default float parse is off-by-1-ulp (correct
//! rounding is the opt-in `float_roundtrip` feature), so floats in vectors are a trap.

use magic_color_core::rng::Mulberry32;
use serde::Deserialize;

#[derive(Deserialize)]
struct RngVectors {
    mulberry32: Vec<RngCase>,
}

#[derive(Deserialize)]
struct RngCase {
    seed: u32,
    draws: Vec<u32>,
}

#[test]
fn mulberry32_matches_js_vectors() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../vectors/rng.json");
    let raw = std::fs::read_to_string(path)
        .expect("vectors/rng.json missing — the committed golden vectors were deleted?");
    let vectors: RngVectors = serde_json::from_str(&raw).unwrap();
    assert!(!vectors.mulberry32.is_empty());

    for case in &vectors.mulberry32 {
        let mut rng = Mulberry32::new(case.seed);
        for (i, &expected) in case.draws.iter().enumerate() {
            let got = rng.next_u32();
            assert_eq!(got, expected, "seed {} draw {}", case.seed, i);
        }
    }
}
