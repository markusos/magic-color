# Frozen golden vectors

Regression pins for the Rust core (`core/tests/*` replays them and requires exact agreement):

- `rng.json` — raw mulberry32 u32 draws (stored as u32, not floats — serde's default float
  parse is off-by-1-ulp).
- `solver.json` — generated boards + solutions, mechanic overlays, capped-search results and
  useful-move sets.
- `difficulty.json` — difficulty metrics, composite scores, slot assignments.

These were emitted from the JS implementation at the Rust-port cutover (Track F) and are
**frozen**: the JS twin and its emitter (`scripts/emit-vectors.ts`) were retired once the port
proved parity, so the vectors can no longer be regenerated from a second implementation. They
pin the core against *unintentional* drift. On an intentional rule change, update the affected
vectors from the Rust side (add a small emitter in `core/` or hand-edit the affected entries)
in the same commit as the rule change — and say so in the commit message.
