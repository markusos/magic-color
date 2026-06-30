import { useMemo, useRef, useState } from 'react';
import type { LevelProvenance } from '../src/game/provenance';
import { buildReport, diffProvenance, histogram, REPORT_METRICS } from '../src/game/levelReport';
import { committedLevels, METRICS, parseProvenance, TARGET_ACCESSOR } from './data';
import { type Band, MetricChart } from './MetricChart';

/** Round a count up to a tidy axis maximum. */
function niceMax(values: number[]): number {
  const max = values.length ? Math.max(...values) : 1;
  return Math.max(10, Math.ceil(max / 10) * 10);
}

interface Loaded {
  name: string;
  version?: string;
  levels: LevelProvenance[];
}

/** The interactive bake report: every difficulty metric as a curve across the campaign, with shared
 *  hover, per-chapter summaries, a score histogram, and an optional comparison against a second bake. */
export function Report() {
  const levels = useMemo(() => committedLevels(), []);
  const chapters = useMemo(() => buildReport(levels), [levels]);
  const optimalMax = useMemo(() => niceMax(levels.map((p) => p.metrics.optimal)), [levels]);

  const bands = useMemo<Band[]>(() => {
    const idx = new Map(levels.map((p, i) => [p.level, i]));
    return chapters.map((c) => ({
      chapter: c.chapter,
      startIdx: idx.get(c.firstLevel) ?? 0,
      endIdx: idx.get(c.lastLevel) ?? 0,
    }));
  }, [levels, chapters]);

  const [hovered, setHovered] = useState<number | null>(null);
  const [showBands, setShowBands] = useState(true);
  const [showPoints, setShowPoints] = useState(false);
  const [compare, setCompare] = useState<Loaded | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const compareByLevel = useMemo(
    () => (compare ? new Map(compare.levels.map((p) => [p.level, p])) : null),
    [compare],
  );
  const diff = useMemo(
    () => (compare ? diffProvenance(compare.levels, levels) : null),
    [compare, levels],
  );

  const onFile = (file: File): void => {
    void file.text().then((text) => {
      try {
        const { version, levels: parsed } = parseProvenance(text);
        setCompare({ name: file.name, version, levels: parsed });
      } catch {
        alert(`Could not parse ${file.name} as provenance JSON.`);
      }
    });
  };

  const hoveredLevel = hovered !== null ? levels[hovered] : undefined;
  const yMaxFor = (unit: '01' | 'count'): number => (unit === '01' ? 1 : optimalMax);

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <header className="header">
        <div>
          <h1>Magic Color — Bake Report</h1>
          <p className="sub">
            {levels.length} levels · {chapters.length} chapters
            {compare && (
              <>
                {' '}· comparing <b>{compare.name}</b> → committed
              </>
            )}
          </p>
        </div>
        <div className="controls">
          <label className="chk">
            <input type="checkbox" checked={showBands} onChange={(e) => setShowBands(e.target.checked)} /> chapter bands
          </label>
          <label className="chk">
            <input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} /> points
          </label>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <button onClick={() => fileInput.current?.click()}>Compare file…</button>
          {compare && <button onClick={() => setCompare(null)}>Clear</button>}
        </div>
      </header>

      <p className="hint">Hover any chart to inspect a level across all metrics. Drop a provenance JSON anywhere to diff two bakes.</p>

      <div className="layout">
        <main className="charts">
          {METRICS.map((m) => (
            <MetricChart
              key={m.key}
              levels={levels}
              accessor={m.accessor}
              label={m.key === 'score' ? 'score + target' : m.label}
              color={m.color}
              yMax={yMaxFor(m.unit)}
              bands={bands}
              hovered={hovered}
              onHover={setHovered}
              showBands={showBands}
              showPoints={showPoints}
              compare={
                m.key === 'score'
                  ? { values: levels.map(TARGET_ACCESSOR), color: '#7aa2ff' }
                  : compareByLevel
                    ? { values: levels.map((p) => compareByLevel.get(p.level)).map((c) => (c ? m.accessor(c) : undefined)), color: '#ffffff' }
                    : undefined
              }
            />
          ))}
        </main>

        <aside className="detail">
          {hoveredLevel ? (
            <LevelDetail level={hoveredLevel} compare={compareByLevel?.get(hoveredLevel.level)} />
          ) : (
            <p className="muted">Hover a chart…</p>
          )}
        </aside>
      </div>

      <ChapterTable chapters={chapters} />

      <ScoreHistogram levels={levels} compareLevels={compare?.levels} />

      {diff && compare && <DiffTable name={compare.name} diff={diff} />}
    </div>
  );
}

function kv(label: string, value: string | number) {
  return (
    <div className="kv">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function LevelDetail({ level, compare }: { level: LevelProvenance; compare?: LevelProvenance }) {
  const m = level.metrics;
  const dScore = compare ? level.score - compare.score : null;
  return (
    <div className="card">
      <h3>
        L{level.level} <span className="muted">ch {level.chapter} · {level.phase}</span>
      </h3>
      {kv('footprint', level.footprint)}
      {kv('family', level.family)}
      {kv('score', `${level.score.toFixed(3)}${dScore !== null ? `  (${dScore >= 0 ? '+' : ''}${dScore.toFixed(3)})` : ''}`)}
      {kv('target', level.targetPercentile.toFixed(3))}
      {kv('optimal', `${m.optimal}${m.optimalExact ? '' : ' (proxy)'}`)}
      {kv('2★ ≤', m.twoStarMax)}
      <div className="divider" />
      {kv('dead-end', m.deadEndDensity.toFixed(3))}
      {kv('forced', m.forcedMoveRatio.toFixed(3))}
      {kv('dig depth', m.digDepth.toFixed(3))}
      {kv('funnel', m.funnelLoad.toFixed(3))}
      {kv('ice', m.iceLoad.toFixed(3))}
    </div>
  );
}

function ChapterTable({ chapters }: { chapters: ReturnType<typeof buildReport> }) {
  return (
    <section className="section">
      <h2>Per-chapter summary</h2>
      <table>
        <thead>
          <tr>
            <th>ch</th>
            <th>levels</th>
            <th>score min/mean/max</th>
            <th>opt mean</th>
            <th>exact</th>
            {REPORT_METRICS.map((k) => (
              <th key={k}>{k.replace(/(Density|Ratio|Load)$/, '')}</th>
            ))}
            <th>families</th>
            <th>slips</th>
          </tr>
        </thead>
        <tbody>
          {chapters.map((c) => (
            <tr key={c.chapter}>
              <td>{c.chapter}</td>
              <td>{c.firstLevel}–{c.lastLevel}</td>
              <td>{c.score.min.toFixed(2)} / {c.score.mean.toFixed(2)} / {c.score.max.toFixed(2)}</td>
              <td>{c.optimal.mean.toFixed(1)}</td>
              <td>{Math.round(c.exactRate * 100)}%</td>
              {REPORT_METRICS.map((k) => (
                <td key={k}>{c.metricMeans[k].toFixed(2)}</td>
              ))}
              <td className="families">
                {Object.entries(c.families)
                  .sort((a, b) => b[1] - a[1])
                  .map(([f, n]) => `${f} ${n}`)
                  .join(', ')}
              </td>
              <td className={c.monotonicity.length ? 'warn' : ''}>{c.monotonicity.length || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ScoreHistogram({
  levels,
  compareLevels,
}: {
  levels: LevelProvenance[];
  compareLevels?: LevelProvenance[];
}) {
  const buckets = histogram(levels.map((p) => p.score), 10, 0, 1);
  const cmp = compareLevels ? histogram(compareLevels.map((p) => p.score), 10, 0, 1) : null;
  const max = Math.max(...buckets, ...(cmp ?? [0]));
  return (
    <section className="section">
      <h2>Score distribution</h2>
      <div className="hist">
        {buckets.map((c, i) => (
          <div className="hbar" key={i} title={`${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${c}`}>
            {cmp && <div className="hbar-cmp" style={{ height: `${(cmp[i]! / max) * 100}%` }} />}
            <div className="hbar-fill" style={{ height: `${(c / max) * 100}%` }} />
            <span className="hbar-x">{(i / 10).toFixed(1)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DiffTable({ name, diff }: { name: string; diff: ReturnType<typeof diffProvenance> }) {
  return (
    <section className="section">
      <h2>
        Diff <span className="muted">{name} → committed</span>
      </h2>
      <p className="sub">
        added {diff.added.length ? diff.added.join(', ') : 'none'} · removed{' '}
        {diff.removed.length ? diff.removed.join(', ') : 'none'} · {diff.changed.length} changed ·{' '}
        {diff.unchanged} unchanged
      </p>
      {diff.changed.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>level</th>
              <th>Δscore</th>
              <th>score</th>
              <th>Δopt</th>
              <th>family</th>
            </tr>
          </thead>
          <tbody>
            {diff.changed.slice(0, 60).map((d) => (
              <tr key={d.level}>
                <td>L{d.level}</td>
                <td className={d.dScore >= 0 ? 'pos' : 'neg'}>
                  {d.dScore >= 0 ? '+' : ''}
                  {d.dScore.toFixed(3)}
                </td>
                <td>{d.scoreA.toFixed(2)} → {d.scoreB.toFixed(2)}</td>
                <td>{d.dOptimal >= 0 ? '+' : ''}{d.dOptimal}</td>
                <td>{d.familyA === d.familyB ? d.familyA : `${d.familyA} → ${d.familyB}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
