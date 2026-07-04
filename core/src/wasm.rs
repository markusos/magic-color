//! wasm-bindgen surface for the browser worker target. F0 exposes only enough to prove the
//! boundary end-to-end (version + a deterministic rng sample); the real worker API (hint,
//! stuck-check, live gen) lands in F3.

use wasm_bindgen::prelude::*;

use crate::rng::Mulberry32;

/// Core build version, for the diagnostics readout (PLAN.md E9/F5: "show core: wasm/js").
#[wasm_bindgen]
pub fn core_version() -> String {
    crate::CORE_VERSION.to_string()
}

/// First `n` draws of `mulberry32(seed)` — the boundary smoke test: JS can assert these equal
/// its own rng output, proving the module loads and shares the deterministic core.
#[wasm_bindgen]
pub fn rng_sample(seed: u32, n: u32) -> Vec<f64> {
    let mut rng = Mulberry32::new(seed);
    (0..n).map(|_| rng.next_f64()).collect()
}
