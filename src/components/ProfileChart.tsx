import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { sampleAt } from '../lib/descent';
import { describeSample, fmtAlt, fmtAltShort, fmtDist, fmtDuration, fmtVs, pathKind, type PathKind } from '../lib/format';
import type { DescentResult, FlightPlan, Node, Sample, Settings } from '../lib/types';

export type ChartRange = 'all' | '60' | '25';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  result: DescentResult;
  range: ChartRange;
  hoverD: number | null;
  onHover: (d: number | null) => void;
  ownship: { d: number; alt: number } | null;
}

const COLOR: Record<PathKind, string> = {
  normal: 'var(--accent)',
  brake: 'var(--warn)',
  steep: 'var(--bad)',
};

function niceStep(range: number, target: number, steps: number[]): number {
  for (const s of steps) if (range / s <= target) return s;
  return steps[steps.length - 1];
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(960);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(300, Math.round(entries[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(300, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Runs of the same kind, each sharing its first point with the run before. */
function runs(samples: Sample[]): { kind: PathKind; pts: Sample[] }[] {
  const out: { kind: PathKind; pts: Sample[] }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const kind = pathKind(samples[i]);
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.pts.push(samples[i]);
    else out.push({ kind, pts: [samples[i - 1], samples[i]] });
  }
  return out;
}

/** Chart-style restriction mark: a bar at the altitude, with a wedge on the side that is closed off. */
function RestrictionMark({ node, x, y, tl, missed }: { node: Node; x: number; y: (a: number) => number; tl: number; missed: boolean }) {
  const r = node.restriction;
  if (r.altType === 'none' || r.alt1 == null) return null;
  const color = missed ? 'var(--bad)' : 'var(--ink)';
  const wedge = (alt: number, floor: boolean) => {
    const yy = y(alt);
    const s = floor ? 1 : -1;
    return <path d={`M${x - 5},${yy + s * 8} L${x + 5},${yy + s * 8} L${x},${yy + s * 1.5} Z`} fill={color} />;
  };
  const bar = (alt: number) => <line x1={x - 7} x2={x + 7} y1={y(alt)} y2={y(alt)} stroke={color} strokeWidth={2} strokeLinecap="round" />;
  const label = (alt: number, dy: number) => (
    <text x={x + 11} y={y(alt) + dy} className="c-restr" fill={color}>
      {fmtAltShort(alt, tl)}
    </text>
  );
  if (r.altType === 'at')
    return (
      <g>
        {wedge(r.alt1, true)}
        {wedge(r.alt1, false)}
        {bar(r.alt1)}
        {label(r.alt1, 4)}
      </g>
    );
  if (r.altType === 'above')
    return (
      <g>
        {wedge(r.alt1, true)}
        {bar(r.alt1)}
        {label(r.alt1, 13)}
      </g>
    );
  if (r.altType === 'below')
    return (
      <g>
        {wedge(r.alt1, false)}
        {bar(r.alt1)}
        {label(r.alt1, -6)}
      </g>
    );
  const lo = Math.min(r.alt1, r.alt2 ?? r.alt1);
  const hi = Math.max(r.alt1, r.alt2 ?? r.alt1);
  return (
    <g>
      <line x1={x} x2={x} y1={y(lo)} y2={y(hi)} stroke={color} strokeWidth={1} />
      {wedge(lo, true)}
      {bar(lo)}
      {wedge(hi, false)}
      {bar(hi)}
      {label(lo, 13)}
      {label(hi, -6)}
    </g>
  );
}

function ProfileChartImpl({ plan, settings, result, range, hoverD, onHover, ownship }: Props) {
  const [wrapRef, width] = useWidth();
  const tl = settings.transLevel;
  const { samples, nodes, fixes } = result;

  const todD = result.tod?.d ?? result.totalDist;
  const fullMax = Math.min(result.totalDist, todD * 1.08 + 6);
  const xMax = range === 'all' ? fullMax : Math.min(fullMax, range === '60' ? 60 : 25);
  const xMin = -xMax * 0.02;

  const compact = width < 560;
  const ml = compact ? 44 : 54;
  const mr = compact ? 10 : 18;
  const mt = 52;
  const mb = 34;
  const plotW = width - ml - mr;
  const plotH = Math.round(Math.min(400, Math.max(230, width * 0.36)));
  const height = mt + plotH + mb;
  const x = (d: number) => ml + ((xMax - d) / (xMax - xMin)) * plotW;
  const invX = (px: number) => xMax - ((px - ml) / plotW) * (xMax - xMin);

  const vis = useMemo(() => samples.filter((s) => s.d <= xMax + 0.5), [samples, xMax]);
  const maxAlt = vis.reduce((m, s) => Math.max(m, s.alt), 0);
  const top = maxAlt * 1.1 + 400;
  const y = (alt: number) => mt + plotH - (Math.max(0, alt) / top) * plotH;

  const altStep = niceStep(top, 6, [500, 1000, 2000, 5000, 10000]);
  const altTicks: number[] = [];
  for (let a = altStep; a <= top - altStep * 0.25; a += altStep) altTicks.push(a);
  const xStep = niceStep(xMax, compact ? 5 : 8, [5, 10, 20, 50]);
  const xTicks: number[] = [];
  for (let d = 0; d <= xMax; d += xStep) xTicks.push(d);

  const pathRuns = useMemo(() => runs(vis), [vis]);
  const line = (pts: Sample[]) => pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.d).toFixed(1)},${y(s.alt).toFixed(1)}`).join('');
  const area = vis.length ? `${line(vis)}L${x(vis[vis.length - 1].d).toFixed(1)},${y(0)}L${x(vis[0].d).toFixed(1)},${y(0)}Z` : '';
  const hasBrake = pathRuns.some((r) => r.kind === 'brake');
  const hasSteep = pathRuns.some((r) => r.kind === 'steep');

  /* fix names along the top, staggered over two rows; a name that still collides is left out */
  const visNodes = nodes.filter((n) => n.distToGo <= xMax);
  const labels: { n: Node; px: number; row: number; text: string }[] = [];
  {
    const pri = (n: Node) => (n.kind === 'airport' ? 2 : n.restriction.altType !== 'none' || n.restriction.speed != null ? 1 : 0);
    const sorted = [...visNodes].sort((a, b) => pri(b) - pri(a) || b.distToGo - a.distToGo);
    const placed: { from: number; to: number; row: number }[] = [];
    for (const n of sorted) {
      const text = n.kind === 'airport' ? `${n.ident} ${plan.dest.runway}`.trim() : n.ident;
      const w = text.length * 6.6 + 10;
      const px = x(n.distToGo);
      const from = Math.max(ml - 20, Math.min(px - w / 2, ml + plotW + mr - w));
      for (let row = 0; row < 2; row++) {
        if (!placed.some((p) => p.row === row && from < p.to && from + w > p.from)) {
          placed.push({ from, to: from + w, row });
          labels.push({ n, px: from + w / 2, row, text });
          break;
        }
      }
    }
  }
  const labelled = new Map(labels.map((l) => [l.n.id, l]));
  const labelY = (row: number) => mt - 34 + row * 15;

  const hover = hoverD != null && hoverD <= xMax ? sampleAt(samples, Math.max(0, hoverD)) : null;
  const hx = hover ? x(hover.d) : 0;
  const flip = hx > width * 0.6;
  const tod = result.tod && result.tod.d <= xMax ? result.tod : null;
  const ownSample = ownship && ownship.d <= xMax ? sampleAt(samples, ownship.d) : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = invX(e.clientX - rect.left);
    onHover(d < xMin || d > xMax ? null : Math.max(0, d));
  };

  return (
    <div className="chart" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Descent path from ${fmtAlt(settings.cruiseAlt, tl)} to runway ${plan.dest.runway} at ${plan.dest.icao}`}
        onPointerMove={onMove}
        onPointerLeave={() => onHover(null)}
        style={{ touchAction: 'pan-y' }}
      >
        <defs>
          <linearGradient id="under" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <clipPath id="plot">
            <rect x={ml - 8} y={mt - 12} width={plotW + mr + 8} height={plotH + 16} />
          </clipPath>
        </defs>

        {/* altitude grid */}
        {altTicks.map((a) => (
          <g key={a}>
            <line x1={ml} x2={ml + plotW} y1={y(a)} y2={y(a)} className="c-grid" />
            <text x={ml - 10} y={y(a) + 4} textAnchor="end" className="c-axis">
              {fmtAltShort(a, tl)}
            </text>
          </g>
        ))}
        <line x1={ml} x2={ml + plotW} y1={y(0)} y2={y(0)} className="c-base" />

        {/* distance axis */}
        {xTicks.map((d) => (
          <text key={d} x={x(d)} y={y(0) + 18} textAnchor="middle" className="c-axis">
            {d}
          </text>
        ))}
        <text x={ml} y={height - 2} className="c-axis">
          NM to run
        </text>

        {/* fix names, each with a guide line down to where the path crosses it */}
        {visNodes.map((n) => {
          const l = labelled.get(n.id);
          if (!l) return null;
          const px = x(n.distToGo);
          return (
            <g key={n.id}>
              <line x1={px} x2={px} y1={labelY(l.row) + 5} y2={y(fixes[n.id].alt)} className="c-guide" />
              <text x={l.px} y={labelY(l.row)} textAnchor="middle" className={n.kind === 'airport' ? 'c-fix c-fix-strong' : 'c-fix'}>
                {l.text}
              </text>
            </g>
          );
        })}

        <g clipPath="url(#plot)">
          {area && <path d={area} fill="url(#under)" />}
          {pathRuns.map((r, i) => (
            <path key={i} d={line(r.pts)} fill="none" stroke={COLOR[r.kind]} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {visNodes.map((n) =>
            n.kind === 'airport' || !labelled.has(n.id) || (n.restriction.altType !== 'none' && n.restriction.alt1 != null) ? null : <circle key={n.id} cx={x(n.distToGo)} cy={y(fixes[n.id].alt)} r={3} className="c-dot" />,
          )}

          {visNodes.map((n) => (
            <RestrictionMark key={n.id} node={n} x={x(n.distToGo)} y={y} tl={tl} missed={fixes[n.id].status === 'missed' || fixes[n.id].status === 'conflict'} />
          ))}

          {/* runway */}
          <rect x={x(0) - 8} y={y(settings.runwayElev) - 2.5} width={16} height={5} rx={1.5} fill="var(--ink)" />

          {tod && (
            <g>
              <circle cx={x(tod.d)} cy={y(settings.cruiseAlt)} r={6} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2.5} />
              <text x={Math.max(ml + 4, x(tod.d) - 8)} y={y(settings.cruiseAlt) - 13} className="c-tod">
                Top of descent
              </text>
            </g>
          )}

          {ownship && ownSample && (
            <g>
              <line x1={x(ownship.d)} x2={x(ownship.d)} y1={y(ownship.alt)} y2={y(ownSample.alt)} className="c-own-line" />
              <circle cx={x(ownship.d)} cy={y(ownship.alt)} r={6} className="c-own" />
              <text x={x(ownship.d) + 11} y={y(ownship.alt) + 4} className="c-restr" fill="var(--ink)">
                You
              </text>
            </g>
          )}
        </g>

        {hover && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={mt - 8} y2={y(0)} className="c-cross" />
            <circle cx={hx} cy={y(hover.alt)} r={5} fill="var(--surface)" stroke={COLOR[pathKind(hover)]} strokeWidth={2.5} />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className={`tip${flip ? ' tip-flip' : ''}`}
          style={{ left: flip ? hx - 12 : hx + 12, top: y(hover.alt) > mt + plotH * 0.55 ? Math.max(4, y(hover.alt) - 108) : y(hover.alt) + 16 }}
          role="status"
        >
          <p className="tip-main">
            <strong>{fmtAlt(hover.alt, tl)}</strong>
            <span>{fmtDist(hover.d)} NM to run</span>
          </p>
          <p className="tip-sub">
            {Math.round(hover.cas)} kt, {fmtVs(hover.vs)} ft/min
          </p>
          <p className="tip-sub">{fmtDuration(hover.t)} to touchdown</p>
          <p className={`tip-mode tip-${pathKind(hover)}`}>{describeSample(hover)}</p>
        </div>
      )}

      {(hasBrake || hasSteep) && (
        <ul className="chart-key">
          {hasBrake && (
            <li>
              <i style={{ background: 'var(--warn)' }} />
              Speedbrake needed
            </li>
          )}
          {hasSteep && (
            <li>
              <i style={{ background: 'var(--bad)' }} />
              Too steep to hold speed
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export const ProfileChart = memo(ProfileChartImpl);
