import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { hasBakedLevel } from '../../game/levelLoader';
import { chapterForLevel } from '../../game/progression';
import { getProvenance, type LevelProvenance } from '../../game/provenance';
import { boardFootprint } from './footprint';
import styles from './InspectorPanel.module.css';

/** One label/value line. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}

/**
 * Debug readout (Track E1): surfaces what `getLevel` produced for the active board — the live
 * `PlayableLevel` metadata always, plus the baked level's bake-time provenance (difficulty score,
 * curve target, the six measured metrics) when running in DEV. Turns "this level feels wrong" into a
 * number. Rendered as the body of the ⓘ popover (`InfoButton`) when the admin inspector is enabled;
 * that owns showing/dismissing it, so this is pure presentation.
 */
export function InspectorPanel() {
  const level = useGameStore((s) => s.level);
  const phase = useGameStore((s) => s.phase);
  const mode = useGameStore((s) => s.mode);
  const mechanics = useGameStore((s) => s.mechanics);
  const optimal = useGameStore((s) => s.optimal);
  const twoStarMax = useGameStore((s) => s.twoStarMax);
  const current = useGameStore((s) => s.current);
  // For a live board the generator's measurements ride on the store; baked boards leave this null and
  // fall back to the committed (DEV-only) provenance lookup below.
  const liveProv = useGameStore((s) => s.liveProvenance);

  // Only campaign levels can be pre-baked; endless/daily boards are always generated live.
  const baked = mode === 'campaign' && hasBakedLevel(level);
  const [prov, setProv] = useState<LevelProvenance | null>(null);

  // Pull the baked level's provenance (DEV only — `getProvenance` returns null in production). Guard
  // against a late resolve landing on a different board by checking the level hasn't changed.
  useEffect(() => {
    if (!baked) {
      setProv(null);
      return;
    }
    let active = true;
    void getProvenance(level).then((p) => {
      if (active) setProv(p);
    });
    return () => {
      active = false;
    };
  }, [baked, level]);

  const source = baked ? 'baked' : 'live';
  const label = mode === 'campaign' ? `L${level}` : mode === 'daily' ? 'Daily' : 'Random';
  // Unified metrics view: baked boards use the committed (exact) provenance, live boards the generator's
  // (approximate) measurements. Both expose score / targetPercentile / family / metrics.
  const view = baked ? prov : liveProv;
  const m = view?.metrics;

  return (
    <div className={styles.readout} role="group" aria-label="Level inspector">
      <h2 className={styles.title}>Inspector · {label}</h2>

      <Row label="source" value={source} />
      <Row label="phase" value={`${phase} · ch ${mode === 'campaign' ? chapterForLevel(level) : '—'}`} />
      <Row label="footprint" value={boardFootprint(current)} />
      <Row label="mechanics" value={mechanics.length ? mechanics.join(', ') : 'none'} />
      <Row label="optimal / 2★≤" value={`${optimal} / ${twoStarMax}`} />

      {/* Difficulty metrics are a DEV-only debugging aid (baked rows ship dev-only; live ones are
          runtime-computed but kept consistently behind the same guard). */}
      {import.meta.env.DEV &&
        (view ? (
          <>
            <div className={styles.divider} />
            {/* Live boards measure a proxy optimal and a pool-relative score — flag the approximation. */}
            {!baked && <Row label="metrics" value="live · approx" />}
            <Row
              label="score / target"
              value={`${view.score.toFixed(2)} / ${view.targetPercentile.toFixed(2)}`}
            />
            <Row label="family" value={view.family} />
            {m && (
              <>
                <Row label="optimal exact" value={m.optimalExact ? 'yes' : 'no (proxy)'} />
                <Row label="dead-end" value={m.deadEndDensity.toFixed(2)} />
                <Row label="forced" value={m.forcedMoveRatio.toFixed(2)} />
                <Row label="dig depth" value={m.digDepth.toFixed(2)} />
                <Row label="funnel load" value={m.funnelLoad.toFixed(2)} />
                <Row label="ice load" value={m.iceLoad.toFixed(2)} />
              </>
            )}
          </>
        ) : baked ? (
          <Row label="provenance" value="— (DEV only)" />
        ) : (
          <Row label="metrics" value="— (n/a)" />
        ))}
    </div>
  );
}
