import { useMemo, useRef, useState } from 'react';
import type { LevelProvenance } from '../src/game/provenance';
import { buildReport, diffProvenance, histogram, REPORT_METRICS } from '../src/game/levelReport';
import { availableBuilds, type Build, buildFromFile, METRICS, summarize, TARGET_ACCESSOR } from './data';
import { type Band, MetricChart } from './MetricChart';

/** Round a count up to a tidy axis maximum. */
function niceMax(values: number[]): number {
  const max = values.length ? Math.max(...values) : 1;
  return Math.max(10, Math.ceil(max / 10) * 10);
}

/** Short, sortable-looking build stamp for the pickers/table. */
function fmtWhen(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ');
}

function buildLabel(b: Build): string {
  return `${b.committed ? '● ' : ''}${b.label}${b.archivedAt ? ` · ${fmtWhen(b.archivedAt)}` : ''}`;
}

/** The interactive bake report: pick any two archived builds (or committed / a dropped file) as
 *  baseline vs. comparison, see every difficulty metric as a curve, per-chapter summaries, a score
 *  histogram, a full diff, and an overview table ranking all builds so improvement is glanceable. */
export function Report() {
  const archived = useMemo(() => availableBuilds(), []);
  const [dropped, setDropped] = useState<Build[]>([]);
  const builds = useMemo(() => [...archived, ...dropped], [archived, dropped]);

  const committedId = archived.find((b) => b.committed)?.id ?? archived[0]?.id ?? '';
  const [baselineId, setBaselineId] = useState(committedId);
  const [compareId, setCompareId] = useState<string>('');

  const baseline = builds.find((b) => b.id === baselineId) ?? builds[0]!;
  const compare = compareId ? (builds.find((b) => b.id === compareId) ?? null) : null;

  const levels = baseline.levels;
  const chapters = useMemo(() => buildReport(levels), [levels]);
  const optimalMax = useMemo(
    () => niceMax([...levels, ...(compare?.levels ?? [])].map((p) => p.metrics.optimal)),
    [levels, compare],
  );

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
  const fileInput = useRef<HTMLInputElement>(null);

  const compareByLevel = useMemo(
    () => (compare ? new Map(compare.levels.map((p) => [p.level, p])) : null),
    [compare],
  );
  const diff = useMemo(() => (compare ? diffProvenance(compare.levels, levels) : null), [compare, levels]);

  const onFile = (file: File): void => {
    void file.text().then((text) => {
      try {
        const b = buildFromFile(file.name, text);
        setDropped((prev) => [...prev.filter((p) => p.id !== b.id), b]);
        setCompareId(b.id);
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
            {levels.length} levels · {chapters.length} chapters · {builds.length} build
            {builds.length === 1 ? '' : 's'} in history
            {compare && (
              <>
                {' '}
                · diff <b>{compare.label}</b> → <b>{baseline.label}</b>
              </>
            )}
          </p>
        </div>
        <div className="controls">
          <label className="pick">
            baseline
            <select value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
              {builds.map((b) => (
                <option key={b.id} value={b.id}>
                  {buildLabel(b)}
                </option>
              ))}
            </select>
          </label>
          <label className="pick">
            compare
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
              <option value="">none</option>
              {builds
                .filter((b) => b.id !== baselineId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {buildLabel(b)}
                  </option>
                ))}
            </select>
          </label>
          <label className="chk">
            <input type="checkbox" checked={showBands} onChange={(e) => setShowBands(e.target.checked)} />{' '}
            bands
          </label>
          <label className="chk">
            <input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} />{' '}
            points
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
          <button onClick={() => fileInput.current?.click()}>Load file…</button>
        </div>
      </header>

      <p className="hint">
        Pick a baseline and a comparison build above (or drop a provenance JSON anywhere) to diff two bakes.
        Hover any chart to inspect a level across all metrics.
      </p>

      <BuildsOverview
        builds={builds}
        baselineId={baselineId}
        compareId={compareId}
        onBaseline={setBaselineId}
        onCompare={(id) => setCompareId((cur) => (cur === id ? '' : id))}
      />

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
                    ? {
                        values: levels
                          .map((p) => compareByLevel.get(p.level))
                          .map((c) => (c ? m.accessor(c) : undefined)),
                        color: '#ffffff',
                      }
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

      {diff && compare && <DiffTable name={`${compare.label} → ${baseline.label}`} diff={diff} />}
    </div>
  );
}

/** Side-by-side aggregates for every build in history, so a bake is judged an improvement at a glance. */
function BuildsOverview({
  builds,
  baselineId,
  compareId,
  onBaseline,
  onCompare,
}: {
  builds: Build[];
  baselineId: string;
  compareId: string;
  onBaseline: (id: string) => void;
  onCompare: (id: string) => void;
}) {
  const rows = useMemo(() => builds.map((b) => ({ build: b, sum: summarize(b.levels) })), [builds]);
  const baseSum = rows.find((r) => r.build.id === baselineId)?.sum;

  return (
    <section className="section">
      <h2>Builds overview</h2>
      <table className="builds">
        <thead>
          <tr>
            <th />
            <th>build</th>
            <th>archived</th>
            <th>levels</th>
            <th>score min / mean / max</th>
            <th>mean opt</th>
            <th>exact</th>
            <th>slips</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ build: b, sum }) => {
            const isBase = b.id === baselineId;
            const isCmp = b.id === compareId;
            const dMean = baseSum && !isBase ? sum.score.mean - baseSum.score.mean : null;
            return (
              <tr key={b.id} className={isBase ? 'base' : isCmp ? 'cmp' : ''}>
                <td className="rowsel">
                  <button
                    className={isBase ? 'on' : ''}
                    title="Use as baseline"
                    onClick={() => onBaseline(b.id)}
                  >
                    base
                  </button>
                  <button
                    className={isCmp ? 'on' : ''}
                    title="Compare against baseline"
                    onClick={() => onCompare(b.id)}
                  >
                    vs
                  </button>
                </td>
                <td>
                  {b.committed && <span className="tag">HEAD</span>} {b.label}
                </td>
                <td className="muted">{fmtWhen(b.archivedAt)}</td>
                <td>{sum.levels}</td>
                <td>
                  {sum.score.min.toFixed(2)} / <b>{sum.score.mean.toFixed(3)}</b> / {sum.score.max.toFixed(2)}
                  {dMean !== null && (
                    <span className={dMean >= 0 ? 'pos' : 'neg'}>
                      {' '}
                      ({dMean >= 0 ? '+' : ''}
                      {dMean.toFixed(3)})
                    </span>
                  )}
                </td>
                <td>{sum.meanOptimal.toFixed(1)}</td>
                <td>{Math.round(sum.exactRate * 100)}%</td>
                <td className={sum.slips ? 'warn' : ''}>{sum.slips || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
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
        L{level.level}{' '}
        <span className="muted">
          ch {level.chapter} · {level.phase}
        </span>
      </h3>
      {kv('footprint', level.footprint)}
      {kv('family', level.family)}
      {kv(
        'score',
        `${level.score.toFixed(3)}${dScore !== null ? `  (${dScore >= 0 ? '+' : ''}${dScore.toFixed(3)})` : ''}`,
      )}
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
              <td>
                {c.firstLevel}–{c.lastLevel}
              </td>
              <td>
                {c.score.min.toFixed(2)} / {c.score.mean.toFixed(2)} / {c.score.max.toFixed(2)}
              </td>
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
  const buckets = histogram(
    levels.map((p) => p.score),
    10,
    0,
    1,
  );
  const cmp = compareLevels
    ? histogram(
        compareLevels.map((p) => p.score),
        10,
        0,
        1,
      )
    : null;
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
        Diff <span className="muted">{name}</span>
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
                <td>
                  {d.scoreA.toFixed(2)} → {d.scoreB.toFixed(2)}
                </td>
                <td>
                  {d.dOptimal >= 0 ? '+' : ''}
                  {d.dOptimal}
                </td>
                <td>{d.familyA === d.familyB ? d.familyA : `${d.familyA} → ${d.familyB}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
