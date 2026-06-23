/**
 * Worker for the parallel level bake (see build-levels.ts). One job = one (chapter, shape) pool:
 * generate the shape's candidates and measure each precisely (exact optimal + dead-end sampling).
 * Every job is independent and fully seed-deterministic, so running them across a worker pool and
 * reassembling in canonical (chapter, shape, candidate) order yields byte-identical output to a
 * serial bake — parallelism is purely a speed change.
 *
 * Launched by build-levels.ts via worker_threads with the parent's execArgv (so the tsx loader is
 * inherited and this .ts file runs directly). Importing this module on the main thread is harmless:
 * `parentPort` is null there, so the message handler is never attached.
 */
import { parentPort } from 'node:worker_threads';

import { measureMetrics, type Metrics } from '../src/game/difficulty';
import { buildOverlays, type OverlaySet, staticOverlays } from '../src/game/mechanics';
import { generateCandidates } from '../src/game/generator';
import { seedForLevel, SHAPES } from '../src/game/progression';
import type { GameState, Mechanic, Move } from '../src/game/types';

/** A measured candidate. Carries its full {@link OverlaySet} (hidden/funnels/ice) for slot assignment. */
export interface Candidate extends OverlaySet {
  state: GameState;
  solution: Move[];
  metrics: Metrics;
  family: string;
  bottles: number;
  capacity: number;
  par: number;
}

/** One unit of bake work: a single shape's candidate pool for one chapter. */
export interface ShapeJob {
  chapter: number;
  /** Index into SHAPES. */
  si: number;
  /** The chapter's cumulative mechanic set (drives the registry's overlay build). */
  mechanics: Mechanic[];
  /** Per-mechanic application density for this chapter (see `campaignDensity`). */
  density: Record<Mechanic, number>;
  perShape: number;
  nodeBudget: number;
  deadEndSamples: number;
}

/** Generate + measure one shape's candidate pool. Pure and deterministic given the job. */
export function buildShapePool(job: ShapeJob): Candidate[] {
  const { chapter, si, mechanics, density, perShape, nodeBudget, deadEndSamples } = job;
  const shape = SHAPES[si]!;
  const seed = seedForLevel(50_000 + chapter * 100 + si);
  const candidates = generateCandidates(
    { colors: shape.colors, bottles: shape.bottles, capacity: shape.capacity, seed },
    perShape,
  );
  return candidates.map((c, ci) => {
    const tag = chapter * 1_000_000 + si * 10_000 + ci;
    const overlays = buildOverlays(mechanics, {
      state: c.state,
      solution: c.solution,
      seed: seedForLevel(tag),
      density,
    });
    const metrics = measureMetrics(
      c.state,
      overlays.hidden,
      c.solution,
      { optimalNodeBudget: nodeBudget, deadEndSamples, deadEndSeed: tag },
      staticOverlays(overlays),
    );
    return {
      state: c.state,
      solution: c.solution,
      ...overlays,
      metrics,
      family: shape.family,
      bottles: shape.bottles,
      capacity: shape.capacity,
      par: c.par,
    };
  });
}

if (parentPort) {
  const port = parentPort;
  port.on('message', (job: ShapeJob & { id: number }) => {
    port.postMessage({ id: job.id, candidates: buildShapePool(job) });
  });
}
