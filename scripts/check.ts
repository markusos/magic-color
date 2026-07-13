/**
 * Quality-gate entry point — run via `npm run check` (locally and in CI) or `exe/test`.
 *
 * The orchestration lives in `./gate.ts` so the exact same steps run everywhere; this file is just
 * the CLI shell. Usage:
 *
 *   npm run check                 # full gate — lanes (app | core | e2e) run concurrently
 *   npm run check -- --serial     # one step at a time, grouped output (cleaner for debugging)
 *   npm run check -- bake-out     # point the baked-level self-check at an artifacts dir
 *   npm run check -- --skip=e2e   # drop steps by id
 */
import { resolveContext, runGate } from './gate';

process.exit(await runGate(resolveContext(process.argv.slice(2))));
