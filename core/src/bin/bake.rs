//! Native bake CLI (PLAN.md F2). F0 stub: proves the native target builds and gives the npm
//! wiring a binary to shell. The real bake (generator + difficulty + progression, rayon
//! parallel, JSON + provenance to a scratch path — never the committed data) lands in F2.

use magic_color_core::{types::PALETTE, CORE_VERSION};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("bake {CORE_VERSION}");
        return;
    }
    println!("bake {CORE_VERSION} — F0 stub (palette: {} colors)", PALETTE.len());
    println!("The real bake lands in F2; this binary only proves the native target builds.");
    std::process::exit(if args.is_empty() { 0 } else { 2 });
}
