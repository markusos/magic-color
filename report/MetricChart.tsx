import { useRef } from 'react';
import type { LevelProvenance } from '../src/game/provenance';

/** A chapter's index range within the (level-sorted) series, for background banding. */
export interface Band {
  chapter: number;
  startIdx: number;
  endIdx: number;
}

interface Props {
  levels: LevelProvenance[];
  accessor: (p: LevelProvenance) => number;
  label: string;
  color: string;
  /** Y-axis upper bound. */
  yMax: number;
  bands: Band[];
  /** Hovered series index (shared across all charts), or null. */
  hovered: number | null;
  onHover: (i: number | null) => void;
  showBands: boolean;
  showPoints: boolean;
  /** Optional comparison series (e.g. a second bake), drawn as a dashed line. */
  compare?: { values: (number | undefined)[]; color: string };
}

const W = 600;
const H = 132;
const M = { l: 36, r: 10, t: 10, b: 16 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

/** A single metric's curve across the campaign: chapter bands, the line, a shared crosshair, and dots. */
export function MetricChart({
  levels,
  accessor,
  label,
  color,
  yMax,
  bands,
  hovered,
  onHover,
  showBands,
  showPoints,
  compare,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const n = levels.length;

  const x = (i: number): number => M.l + (n <= 1 ? 0 : (i / (n - 1)) * PW);
  const y = (v: number): number => M.t + PH - (yMax <= 0 ? 0 : Math.min(1, v / yMax) * PH);

  const line = (vals: (number | undefined)[]): string =>
    vals
      .map((v, i) => (v === undefined ? '' : `${i === 0 || vals[i - 1] === undefined ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .join(' ');

  const main = levels.map((p) => accessor(p));

  const handleMove = (e: React.MouseEvent): void => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((relX - M.l) / PW) * (n - 1));
    onHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hoveredLevel = hovered !== null ? levels[hovered] : undefined;
  const hoveredVal = hoveredLevel ? accessor(hoveredLevel) : undefined;

  return (
    <div className="chart">
      <div className="chart-head">
        <span className="chart-label" style={{ color }}>
          {label}
        </span>
        <span className="chart-val">
          {hoveredVal !== undefined
            ? hoveredVal.toFixed(yMax > 1 ? 0 : 2)
            : `0–${yMax > 1 ? Math.round(yMax) : yMax.toFixed(1)}`}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => onHover(null)}
      >
        {showBands &&
          bands.map((b) => (
            <rect
              key={b.chapter}
              x={x(b.startIdx)}
              y={M.t}
              width={Math.max(0, x(b.endIdx) - x(b.startIdx))}
              height={PH}
              fill={b.chapter % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'}
            />
          ))}

        {/* y gridlines: 0, mid, max */}
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={M.t + PH * (1 - t)} y2={M.t + PH * (1 - t)} stroke="rgba(255,255,255,0.08)" />
            <text x={M.l - 4} y={M.t + PH * (1 - t) + 3} className="axis" textAnchor="end">
              {yMax > 1 ? Math.round(yMax * t) : (yMax * t).toFixed(1)}
            </text>
          </g>
        ))}

        {compare && <path d={line(compare.values)} fill="none" stroke={compare.color} strokeWidth={1.25} strokeDasharray="4 3" opacity={0.85} />}
        <path d={line(main)} fill="none" stroke={color} strokeWidth={1.5} />

        {showPoints &&
          main.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={1.4} fill={color} opacity={0.5} />
          ))}

        {hovered !== null && (
          <>
            <line x1={x(hovered)} x2={x(hovered)} y1={M.t} y2={M.t + PH} stroke="rgba(255,255,255,0.4)" />
            {hoveredVal !== undefined && <circle cx={x(hovered)} cy={y(hoveredVal)} r={3} fill={color} stroke="#0b0818" strokeWidth={1} />}
          </>
        )}
      </svg>
    </div>
  );
}
