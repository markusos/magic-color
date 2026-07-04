//! JS-number semantics helpers. The port reproduces JS float behavior exactly where results
//! feed selection decisions; these pin down the two spots where Rust's defaults differ.

/// `Math.round` — JS rounds half UP via `floor(x + 0.5)`, which differs from Rust's
/// `f64::round` (half away from zero) on edge inputs like `0.49999999999999994` (where the
/// `+ 0.5` addition rounds up first). Match JS exactly.
#[inline]
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Deterministic `pow` (libm). NOT guaranteed bit-identical to V8's `Math.pow` (neither is
/// correctly rounded), but bit-identical across OUR two targets (native arm64 and wasm32),
/// which is what bake determinism needs. Cross-language comparisons of anything downstream
/// of a `pow` use tolerance, not equality.
#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_round_edge_case() {
        // The classic: 0.49999999999999994 + 0.5 == 1.0 in f64, so JS Math.round gives 1.
        assert_eq!(js_round(0.499_999_999_999_999_94), 1.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(2.4), 2.0);
    }
}
