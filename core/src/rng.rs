//! Mulberry32, ported bit-for-bit from `src/game/rng.ts`. Every seeded stream (generation,
//! hidden placement, overlay derivation, daily levels) flows through this, so cross-language
//! parity here is a precondition for everything else; `tests/rng_vectors.rs` pins it against
//! JS-emitted vectors (`vectors/rng.json`).

/// Deterministic PRNG matching the JS `mulberry32(seed)` closure. JS's `| 0` / `Math.imul` /
/// `>>>` semantics map to wrapping u32 arithmetic and logical right shifts.
pub struct Mulberry32 {
    a: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { a: seed }
    }

    /// The raw 32-bit draw (JS computes this, then divides by 2^32).
    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        self.a = self.a.wrapping_add(0x6d2b_79f5);
        let a = self.a;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        t ^ (t >> 14)
    }

    /// The JS-visible value in `[0, 1)`: `next_u32() / 2^32`, exact in f64.
    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        self.next_u32() as f64 / 4_294_967_296.0
    }
}
