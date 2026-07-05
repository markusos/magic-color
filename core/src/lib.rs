//! magic-color core — the Rust port of the pure level-generation/evaluation core (Track F).
//!
//! One crate, two targets: `cargo build --release` produces the native `bake` CLI (offline
//! level bake), `wasm-pack build` produces the in-browser worker module. All shared logic is
//! target-agnostic; platform slivers (threads, IO, JS bindings) live behind `cfg`.
//!
//! The JS core (`src/game/*.ts`) stays authoritative until cutover (PLAN.md F4); everything
//! here is validated against it via the `exe/test` gate (shared vectors + conformance traces).

pub mod difficulty;
pub mod engine;
pub mod funnels;
pub mod generator;
pub mod hidden;
pub mod ice;
pub mod jsnum;
pub mod live;
pub mod mechanics;
pub mod progression;
pub mod rng;
pub mod search;
pub mod session;
pub mod solver;
pub mod state;
pub mod types;

#[cfg(target_arch = "wasm32")]
mod wasm;

/// Crate version, exposed on both targets so provenance / diagnostics can name the core build.
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
