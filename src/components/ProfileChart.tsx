import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { sampleAt } from '../lib/descent';
import {
  PATH_COLORS,
  PATH_LABELS,
  describeSample,
  fmtAlt,
  fmtAltShort,
  fmtAngle,
  fmtDist,
  fmtDuration,
  fmtVs,
  pathKind,
  type PathKind,
} from '../lib/format';
import type { DescentResult, FlightPlan, Node, Sample, Settings } from '../lib/types';
import { Segmented, Toggle } from './fields';

export type ChartView = 'descent' | 'arrival' | 'approach';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  result: DescentResult;
  hoverD: number | null;
  onHover: (d: number | null) => void;
  ownship: { d: number; alt: number } | null;
}

const M = { l: 60, r: 22, t: 84, b: 34 };
const GAP = 28;
const STRIP = { speed: 76, vs: 72, wind: 64 };

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
    const ro = new ResizeObserver((entries) => setW(Math.max(320, Math.round(entries[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(320, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Split samples into runs of the same path kind, each run sharing its first point with the previous one. */
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

function RestrictionGlyph({ node, x, y, tl, status }: { node: Node; x: number; y: (a: number) => number; tl: number; status: string }) {
  const r = node.restriction;
  if (r.altType === 'none' || r.alt1 == null) return null;
  const color = status === 'met' ? 'var(--magenta)' : 'var(--red)';
  const tri = (alt: number, floor: boolean) => {
    const yy = y(alt);
    const s = floor ? 1 : -1;
    return <path d={`M${x - 6},${yy + s * 9} L${x + 6},${yy + s * 9} L${x},${yy + s * 1.5} Z`} fill={color} />;
  };
  const bar = (alt: number) => <line x1={x - 8} x2={x + 8} y1={y(alt)} y2={y(alt)} stroke={color} strokeWidth={2} />;
  const label = (alt: number, deco: string, dy: number) => (
    <text x={x + 12} y={y(alt) + dy} className="c-restr" fill={color} textDecoration={deco}>
      {fmtAltShort(alt, tl)}
    </text>
  );
  if (r.altType === 'at')
    return (
      <g>
        {tri(r.alt1, true)}
        {tri(r.alt1, false)}
        {bar(r.alt1)}
        {label(r.alt1, 'underline overline', 4)}
      </g>
    );
  if (r.altType === 'above')
    return (
      <g>
        {tri(r.alt1, true)}
        {bar(r.alt1)}
        {label(r.alt1, 'underline', 13)}
      </g>
    );
  if (r.altType === 'below')
    return (
      <g>
        {tri(r.alt1, false)}
        {bar(r.alt1)}
        {label(r.alt1, 'overline', -6)}
      </g>
    );
  const lo = Math.min(r.alt1, r.alt2 ?? r.alt1);
  const hi = Math.max(r.alt1, r.alt2 ?? r.alt1);
  return (
    <g>
      <line x1={x} x2={x} y1={y(lo)} y2={y(hi)} stroke={color} strokeWidth={1.2} strokeDasharray="2 3" />
      {tri(lo, true)}
      {bar(lo)}
      {tri(hi, false)}
      {bar(hi)}
      {label(lo, 'underline', 13)}
      {label(hi, 'overline', -6)}
    </g>
  );
}

function ProfileChartImpl({ plan, settings, result, hoverD, onHover, ownship }: Props) {
  const [wrapRef, width] = useWidth();
  const [view, setView] = useState<ChartView>('descent');
  const [showPlan, setShowPlan] = useState(true);
  const [showMora, setShowMora] = useState(true);
  const tl = settings.transLevel;
  const { samples, nodes, markers, fixes } = result;

  const todD = result.tod?.d ?? result.totalDist;
  const sbTod = markers.find((m) => m.kind === 'sbtod')?.d ?? 0;
  const fullMax = Math.min(result.totalDist, Math.max(todD, sbTod) * 1.07 + 6);
  const xMax = view === 'descent' ? fullMax : Math.min(fullMax, view === 'arrival' ? 60 : 25);
  const xMin = -xMax * 0.018;

  const compact = width < 640;
  const ml = compact ? 46 : M.l;
  const plotW = width - ml - M.r;
  const mainH = Math.round(Math.min(470, Math.max(260, width * 0.4)));
  const x = (d: number) => ml + ((xMax - d) / (xMax - xMin)) * plotW;
  const invX = (px: number) => xMax - ((px - ml) / plotW) * (xMax - xMin);

  const geo = useMemo(() => {
    const vis = samples.filter((s) => s.d <= xMax + 0.5);
    const maxAlt = vis.reduce((m, s) => Math.max(m, s.alt), 0);
    const top = view === 'descent' ? maxAlt + 2600 : maxAlt * 1.12 + 600;
    return { vis, top };
  }, [samples, xMax, view]);

  const y0 = M.t;
  const y = (alt: number) => y0 + mainH - (Math.max(0, alt) / geo.top) * mainH;

  const speedTop = y0 + mainH + GAP + 2;
  const vsTop = speedTop + STRIP.speed + GAP;
  const windTop = vsTop + STRIP.vs + GAP;
  const height = windTop + STRIP.wind + M.b;

  const altStep = niceStep(geo.top, 8, [500, 1000, 2000, 5000, 10000]);
  const altTicks: number[] = [];
  for (let a = 0; a <= geo.top - altStep * 0.3; a += altStep) altTicks.push(a);
  const xStep = niceStep(xMax, compact ? 6 : 12, [2, 5, 10, 20, 50]);
  const xTicks: number[] = [];
  for (let d = 0; d <= xMax; d += xStep) xTicks.push(d);

  const visNodes = nodes.filter((n) => n.distToGo <= xMax);

  /* ---- path geometry ---- */
  const pathRuns = useMemo(() => runs(geo.vis), [geo.vis]);
  const kindsPresent = useMemo(() => {
    const order: PathKind[] = ['cruise', 'idle', 'geo', 'decel', 'brake', 'steep', 'final'];
    const set = new Set(pathRuns.map((r) => r.kind));
    return order.filter((k) => set.has(k));
  }, [pathRuns]);

  const line = (pts: Sample[], fy: (s: Sample) => number) =>
    pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.d).toFixed(1)},${fy(s).toFixed(1)}`).join('');

  const areaPath = geo.vis.length
    ? `${line(geo.vis, (s) => y(s.alt))}L${x(geo.vis[geo.vis.length - 1].d).toFixed(1)},${y(0)}L${x(geo.vis[0].d).toFixed(1)},${y(0)}Z`
    : '';

  /* MORA floor: each leg takes the value published at the fix it leads to */
  let moraPath = '';
  if (showMora) {
    let started = false;
    let lastX = 0;
    const allReal = nodes.filter((n) => n.kind !== 'custom');
    for (let i = 1; i < allReal.length; i++) {
      const far = allReal[i - 1];
      const near = allReal[i];
      if (near.mora == null || far.distToGo < 0 || near.distToGo > xMax) continue;
      const xa = x(Math.min(far.distToGo, xMax + 1));
      const xb = x(near.distToGo);
      moraPath += `${started ? 'L' : 'M'}${xa.toFixed(1)},${y(near.mora).toFixed(1)}L${xb.toFixed(1)},${y(near.mora).toFixed(1)}`;
      if (!started) moraPath = `M${xa.toFixed(1)},${y(0)}L${xa.toFixed(1)},${y(near.mora).toFixed(1)}L${xb.toFixed(1)},${y(near.mora).toFixed(1)}`;
      started = true;
      lastX = xb;
    }
    if (started) moraPath += `L${lastX.toFixed(1)},${y(0)}Z`;
  }

  const moraLabel = nodes.filter((n) => n.kind !== 'custom' && n.mora != null && n.distToGo <= xMax + 20 && n.distToGo >= xMax * 0.8).map((n) => n.mora as number)[0];

  const sbLine = showPlan
    ? plan.sbProfile
        .map((p) => ({ d: p.ident === plan.sbProfile[plan.sbProfile.length - 1].ident && p.distToGo === 0 ? 0 : p.distToGo + (settings.extraMiles || 0), alt: p.alt }))
        .filter((p) => p.d <= xMax + 30)
        .map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.alt).toFixed(1)}`)
        .join('')
    : '';

  /* ---- strips ---- */
  const casMax = Math.ceil((Math.max(...geo.vis.map((s) => s.cas)) + 12) / 10) * 10;
  const casMin = Math.floor((Math.min(...geo.vis.map((s) => s.cas)) - 12) / 10) * 10;
  const spdStep = casMax - casMin > 130 ? 50 : 20;
  const spdTicks: number[] = [];
  for (let v = Math.ceil(casMin / spdStep) * spdStep; v <= casMax; v += spdStep) spdTicks.push(v);
  const ySpd = (v: number) => speedTop + STRIP.speed - ((v - casMin) / (casMax - casMin)) * STRIP.speed;
  const vsMin = Math.min(-1000, Math.floor(Math.min(...geo.vis.map((s) => s.vs)) / 1000) * 1000);
  const yVs = (v: number) => vsTop + (Math.min(0, v) / vsMin) * STRIP.vs;
  const windMax = Math.max(20, Math.ceil(Math.max(...geo.vis.map((s) => Math.abs(s.tail))) / 20) * 20);
  const windMid = windTop + STRIP.wind / 2;
  const yWind = (v: number) => windMid - (v / windMax) * (STRIP.wind / 2);

  const stepped = (pts: Sample[], fy: (s: Sample) => number) =>
    pts
      .map((s, i) => {
        // each sample describes the stretch flown into it
        if (i === 0) return `M${x(s.d).toFixed(1)},${fy(pts[Math.min(1, pts.length - 1)]).toFixed(1)}`;
        return `L${x(s.d).toFixed(1)},${fy(s).toFixed(1)}`;
      })
      .join('');
  const vsPath = geo.vis.length
    ? `${stepped(geo.vis, (s) => yVs(s.vs))}L${x(geo.vis[geo.vis.length - 1].d).toFixed(1)},${vsTop}L${x(geo.vis[0].d).toFixed(1)},${vsTop}Z`
    : '';
  const windArea = (sign: 1 | -1) =>
    geo.vis.length
      ? `${line(geo.vis, (s) => yWind(sign > 0 ? Math.max(0, s.tail) : Math.min(0, s.tail)))}L${x(geo.vis[geo.vis.length - 1].d).toFixed(1)},${windMid}L${x(geo.vis[0].d).toFixed(1)},${windMid}Z`
      : '';

  const machSpan = (() => {
    const on = geo.vis.filter((s) => s.onMach && s.mode !== 'cruise');
    if (!on.length) return null;
    return { from: on[0].d, to: on[on.length - 1].d };
  })();

  /* ---- hover ---- */
  const hover = hoverD != null && hoverD <= xMax ? sampleAt(samples, Math.max(0, hoverD)) : null;
  const hx = hover ? x(hover.d) : 0;
  const tipLeft = hover ? (hx > width * 0.62 ? hx - 14 : hx + 14) : 0;
  const tipFlip = hover ? hx > width * 0.62 : false;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = invX(e.clientX - rect.left);
    if (d < xMin || d > xMax) onHover(null);
    else onHover(Math.max(0, d));
  };

  /* waypoint labels: drop the plain ones that would collide */
  const labelled = new Set<string>();
  {
    let lastX = -Infinity;
    const order = [...visNodes].sort((a, b) => b.distToGo - a.distToGo);
    for (const n of order) {
      const px = x(n.distToGo);
      const important = n.restriction.altType !== 'none' || n.restriction.speed != null || n.kind !== 'fix';
      if (px - lastX >= 15 || important) {
        labelled.add(n.id);
        lastX = px;
      }
    }
  }

  const tod = markers.find((m) => m.kind === 'tod');
  const sbTodM = markers.find((m) => m.kind === 'sbtod');
  const ownSample = ownship ? sampleAt(samples, ownship.d) : null;

  return (
    <section className="panel chart-panel" aria-label="Vertical profile">
      <header className="panel-head">
        <h2>Vertical profile</h2>
        <div className="chart-controls">
          <Toggle checked={showPlan} onChange={setShowPlan} label="SimBrief profile" />
          <Toggle checked={showMora} onChange={setShowMora} label="Minimum off-route altitude" />
          <Segmented
            label="Chart range"
            value={view}
            onChange={setView}
            options={[
              { value: 'descent', label: 'Whole descent' },
              { value: 'arrival', label: 'Last 60 NM' },
              { value: 'approach', label: 'Last 25 NM' },
            ]}
          />
        </div>
      </header>

      <ul className="legend" aria-label="Path colours">
        {kindsPresent.map((k) => (
          <li key={k}>
            <span className={`swatch${k === 'decel' ? ' swatch-dash' : ''}`} style={{ color: PATH_COLORS[k] }} />
            {PATH_LABELS[k]}
          </li>
        ))}
        <li>
          <svg width="16" height="12" aria-hidden="true">
            <path d="M2,11 L14,11 L8,3 Z" fill="var(--magenta)" />
          </svg>
          Restriction
        </li>
        {showPlan && (
          <li>
            <span className="swatch swatch-dot" style={{ color: 'var(--muted)' }} />
            SimBrief
          </li>
        )}
      </ul>

      <div className="chart-wrap" ref={wrapRef}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Descent profile from ${fmtAlt(settings.cruiseAlt, tl)} to runway ${plan.dest.runway} at ${plan.dest.icao}`}
          onPointerMove={onMove}
          onPointerLeave={() => onHover(null)}
          style={{ touchAction: 'pan-y' }}
        >
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--sky-top)" />
              <stop offset="0.72" stopColor="var(--sky-mid)" />
              <stop offset="1" stopColor="var(--sky-low)" />
            </linearGradient>
            <linearGradient id="under" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--green)" stopOpacity="0.2" />
              <stop offset="1" stopColor="var(--green)" stopOpacity="0.02" />
            </linearGradient>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--terrain)" opacity="0.55" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--terrain-line)" strokeWidth="1.4" opacity="0.7" />
            </pattern>
            <clipPath id="plot">
              <rect x={ml} y={y0} width={plotW} height={mainH} />
            </clipPath>
            <clipPath id="strips">
              <rect x={ml} y={speedTop - 4} width={plotW} height={windTop + STRIP.wind - speedTop + 8} />
            </clipPath>
          </defs>

          {/* sky */}
          <rect x={ml} y={y0} width={plotW} height={mainH} fill="url(#sky)" rx="3" />

          {/* altitude grid */}
          {altTicks.map((a) => (
            <g key={a}>
              <line x1={ml} x2={ml + plotW} y1={y(a)} y2={y(a)} className="c-grid" />
              <text x={ml - 8} y={y(a) + 4} textAnchor="end" className="c-axis">
                {a === 0 ? '0' : fmtAltShort(a, tl)}
              </text>
            </g>
          ))}

          <g clipPath="url(#plot)">
            {/* speed limit altitude and Mach crossover */}
            {settings.limitAlt < geo.top && (
              <g>
                <line x1={ml} x2={ml + plotW} y1={y(settings.limitAlt)} y2={y(settings.limitAlt)} className="c-ref" />
                <text x={ml + 8} y={y(settings.limitAlt) - 5} className="c-ref-text">
                  {settings.limitSpeed} kt below {fmtAltShort(settings.limitAlt, tl)}
                </text>
              </g>
            )}
            {result.crossover < settings.cruiseAlt - 500 && result.crossover < geo.top && view === 'descent' && (
              <g>
                <line x1={ml} x2={ml + plotW} y1={y(result.crossover)} y2={y(result.crossover)} className="c-ref" />
                <text x={ml + 8} y={y(result.crossover) - 5} className="c-ref-text">
                  M {settings.desMach.toFixed(2).replace(/^0/, '')} above, {settings.desCas} kt below
                </text>
              </g>
            )}

            {/* terrain clearance floor */}
            {moraPath && <path d={moraPath} fill="url(#hatch)" stroke="var(--terrain-line)" strokeWidth="1" />}
            {moraPath && moraLabel && (
              <text x={ml + 8} y={y(moraLabel) - 5} className="c-ref-text" fill="var(--terrain-line)">
                Minimum off-route altitude
              </text>
            )}

            {/* waypoint drop lines */}
            {visNodes.map((n) => (
              <line
                key={n.id}
                x1={x(n.distToGo)}
                x2={x(n.distToGo)}
                y1={y0}
                y2={y0 + mainH}
                className={n.kind === 'custom' ? 'c-drop c-drop-custom' : 'c-drop'}
              />
            ))}

            {areaPath && <path d={areaPath} fill="url(#under)" />}
            {sbLine && <path d={sbLine} className="c-sb" />}

            {/* the path */}
            {pathRuns.map((r, i) => (
              <path
                key={i}
                d={line(r.pts, (s) => y(s.alt))}
                fill="none"
                stroke={PATH_COLORS[r.kind]}
                strokeWidth={r.kind === 'cruise' ? 2 : 2.8}
                strokeDasharray={r.kind === 'decel' ? '7 4' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {/* restrictions */}
            {visNodes.map((n) => (
              <RestrictionGlyph key={n.id} node={n} x={x(n.distToGo)} y={y} tl={tl} status={fixes[n.id]?.status ?? 'met'} />
            ))}

            {/* runway */}
            <rect x={x(0) - 9} y={y(settings.runwayElev) - 2} width={18} height={4} fill="var(--text)" rx="1" />

            {/* markers */}
            {markers.map((m, i) => {
              if (m.d > xMax) return null;
              const mx = x(m.d);
              const my = y(m.alt);
              if (m.kind === 'decel')
                return (
                  <g key={i}>
                    <circle cx={mx} cy={my} r={8} fill="var(--bg-inset)" stroke="var(--magenta)" strokeWidth={1.6} />
                    <text x={mx} y={my + 3.6} textAnchor="middle" className="c-dmark">
                      D
                    </text>
                  </g>
                );
              if (m.kind === 'fap')
                return (
                  <g key={i}>
                    <path d={`M${mx},${my - 6} L${mx + 6},${my} L${mx},${my + 6} L${mx - 6},${my} Z`} fill="var(--bg-inset)" stroke="var(--text)" strokeWidth={1.5} />
                    <text x={mx > ml + plotW - 120 ? mx - 10 : mx + 10} y={my - 9} textAnchor={mx > ml + plotW - 120 ? 'end' : 'start'} className="c-marker-text">
                      Glidepath {fmtAltShort(m.alt, tl)}
                    </text>
                  </g>
                );
              return null;
            })}
            {sbTodM && showPlan && sbTodM.d <= xMax && (
              <g>
                <path d={`M${x(sbTodM.d)},${y(sbTodM.alt) - 5} l5,5 l-5,5 l-5,-5 Z`} fill="none" stroke="var(--muted)" strokeWidth={1.4} />
                <text x={x(sbTodM.d) - 9} y={y(sbTodM.alt) + 16} textAnchor="end" className="c-sb-text">
                  SimBrief T/D
                </text>
              </g>
            )}
            {tod && tod.d <= xMax && (
              <g>
                <path
                  d={`M${x(tod.d) - 16},${y(tod.alt)} h16 l9,9`}
                  fill="none"
                  stroke="var(--text)"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d={`M${x(tod.d) + 9},${y(tod.alt) + 9} l-6.5,-1 l5.5,-5.5 Z`} fill="var(--text)" />
                <text x={Math.max(ml + 52, x(tod.d))} y={y(tod.alt) - 10} textAnchor="middle" className="c-tod">
                  T/D {tod.d.toFixed(1)} NM
                </text>
              </g>
            )}

            {/* ownship */}
            {ownship && ownSample && ownship.d <= xMax && (
              <g>
                <line x1={x(ownship.d)} x2={x(ownship.d)} y1={y(ownship.alt)} y2={y(ownSample.alt)} stroke="var(--cyan)" strokeWidth={1.4} strokeDasharray="3 3" />
                <g transform={`translate(${x(ownship.d)},${y(ownship.alt)})`}>
                  <path d="M-11,0 L4,-3.4 L4,-9 L7,-9 L8.5,-3.4 L12,-2.6 L12,2.6 L8.5,3.4 L7,9 L4,9 L4,3.4 Z" fill="var(--cyan)" stroke="var(--bg-inset)" strokeWidth={1} transform="scale(-1,1)" />
                </g>
              </g>
            )}
          </g>

          {/* waypoint labels */}
          {visNodes.map((n) => {
            if (!labelled.has(n.id)) return null;
            const px = x(n.distToGo);
            const cls = n.kind === 'custom' ? 'c-wpt c-wpt-custom' : n.kind === 'airport' ? 'c-wpt c-wpt-apt' : 'c-wpt';
            return (
              <g key={n.id}>
                <line x1={px} x2={px} y1={y0 - 6} y2={y0} className="c-tick" />
                <text transform={`translate(${px + 3},${y0 - 9}) rotate(-52)`} className={cls}>
                  {n.kind === 'airport' ? `${n.ident} ${plan.dest.runway}` : n.ident}
                </text>
              </g>
            );
          })}

          {/* ---- speed strip ---- */}
          <text x={ml} y={speedTop - 7} className="c-strip-title">
            Speed, kt
          </text>
          <rect x={ml} y={speedTop} width={plotW} height={STRIP.speed} className="c-strip-bg" rx="3" />
          {spdTicks.map((v) => (
            <text key={v} x={ml - 8} y={ySpd(v) + 4} textAnchor="end" className="c-axis">
              {v}
            </text>
          ))}
          <g clipPath="url(#strips)">
            {machSpan && (
              <g>
                <rect x={x(machSpan.from)} y={speedTop} width={Math.max(0, x(machSpan.to) - x(machSpan.from))} height={STRIP.speed} fill="var(--text)" opacity="0.06" />
                {x(machSpan.to) - x(machSpan.from) > 54 && (
                  <text x={(x(machSpan.from) + x(machSpan.to)) / 2} y={speedTop + STRIP.speed - 8} textAnchor="middle" className="c-ref-text">
                    Mach {settings.desMach.toFixed(2).replace(/^0/, '')}
                  </text>
                )}
              </g>
            )}
            <path d={line(geo.vis, (s) => ySpd(s.cas))} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" />
            {visNodes
              .filter((n) => n.restriction.speed != null)
              .map((n) => {
                const sp = n.restriction.speed as number;
                const bad = (fixes[n.id]?.cas ?? 0) > sp + 3;
                const c = bad ? 'var(--red)' : 'var(--magenta)';
                return (
                  <g key={n.id}>
                    <line x1={x(n.distToGo)} x2={x(0)} y1={ySpd(sp)} y2={ySpd(sp)} stroke={c} strokeWidth={1} strokeDasharray="2 4" opacity="0.7" />
                    <path d={`M${x(n.distToGo) - 5},${ySpd(sp) - 8} h10 l-5,7 Z`} fill={c} />
                    <text x={x(n.distToGo) + 8} y={ySpd(sp) - 5} className="c-restr" fill={c} textDecoration="overline">
                      {sp}
                    </text>
                  </g>
                );
              })}
          </g>

          {/* ---- vertical speed strip ---- */}
          <text x={ml} y={vsTop - 7} className="c-strip-title">
            Vertical speed, ft/min
          </text>
          <rect x={ml} y={vsTop} width={plotW} height={STRIP.vs} className="c-strip-bg" rx="3" />
          {[0, vsMin / 2, vsMin].map((v) => (
            <text key={v} x={ml - 8} y={yVs(v) + 4} textAnchor="end" className="c-axis">
              {v === 0 ? '0' : `−${Math.abs(v)}`}
            </text>
          ))}
          <g clipPath="url(#strips)">
            <line x1={ml} x2={ml + plotW} y1={yVs(vsMin / 2)} y2={yVs(vsMin / 2)} className="c-grid" />
            <path d={vsPath} fill="var(--green)" fillOpacity="0.22" stroke="var(--green)" strokeWidth={1.6} strokeLinejoin="round" />
          </g>

          {/* ---- wind strip ---- */}
          <text x={ml} y={windTop - 7} className="c-strip-title">
            Wind along track, kt
          </text>
          <rect x={ml} y={windTop} width={plotW} height={STRIP.wind} className="c-strip-bg" rx="3" />
          <text x={ml - 8} y={yWind(windMax) + 9} textAnchor="end" className="c-axis">
            {windMax}
          </text>
          <text x={ml - 8} y={windMid + 4} textAnchor="end" className="c-axis">
            0
          </text>
          <text x={ml - 8} y={yWind(-windMax) - 1} textAnchor="end" className="c-axis">
            {windMax}
          </text>
          <g clipPath="url(#strips)">
            <path d={windArea(1)} fill="var(--tail)" fillOpacity="0.4" stroke="var(--tail)" strokeWidth={1.4} />
            <path d={windArea(-1)} fill="var(--head)" fillOpacity="0.4" stroke="var(--head)" strokeWidth={1.4} />
            <line x1={ml} x2={ml + plotW} y1={windMid} y2={windMid} stroke="var(--rule-strong)" strokeWidth={1} />
            <text x={ml + plotW - 8} y={windTop + 13} textAnchor="end" className="c-ref-text" fill="var(--tail)">
              tailwind
            </text>
            <text x={ml + plotW - 8} y={windTop + STRIP.wind - 6} textAnchor="end" className="c-ref-text" fill="var(--head)">
              headwind
            </text>
          </g>

          {/* shared distance axis */}
          {xTicks.map((d) => (
            <g key={d}>
              <line x1={x(d)} x2={x(d)} y1={windTop + STRIP.wind} y2={windTop + STRIP.wind + 5} className="c-tick" />
              <text x={x(d)} y={windTop + STRIP.wind + 18} textAnchor="middle" className="c-axis">
                {d}
              </text>
            </g>
          ))}
          <text x={ml + plotW} y={height - 3} textAnchor="end" className="c-strip-title">
            NM to run
          </text>

          {/* crosshair */}
          {hover && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={y0} y2={windTop + STRIP.wind} className="c-cross" />
              <circle cx={hx} cy={y(hover.alt)} r={5.5} fill="var(--bg-inset)" stroke="var(--text)" strokeWidth={2} />
              <circle cx={hx} cy={ySpd(hover.cas)} r={3.5} fill="var(--text)" />
              <circle cx={hx} cy={yVs(hover.vs)} r={3.5} fill="var(--green)" />
              <circle cx={hx} cy={yWind(hover.tail)} r={3.5} fill={hover.tail >= 0 ? 'var(--tail)' : 'var(--head)'} />
            </g>
          )}
        </svg>

        {hover && (
          <div className={`tip${tipFlip ? ' tip-flip' : ''}`} style={{ left: tipLeft, top: y(hover.alt) > y0 + mainH * 0.55 ? Math.max(8, y(hover.alt) - 196) : y(hover.alt) + 22 }} role="status">
            <div className="tip-head">
              <strong>{fmtAlt(hover.alt, tl)}</strong>
              <span>{fmtDist(hover.d)} NM to run</span>
            </div>
            <dl>
              <dt>Speed</dt>
              <dd>
                {Math.round(hover.cas)} kt, M {hover.mach.toFixed(2).replace(/^0/, '')}
              </dd>
              <dt>Vertical speed</dt>
              <dd>
                {fmtVs(hover.vs)} ft/min, {fmtAngle(hover.fpa)}
              </dd>
              <dt>Ground speed</dt>
              <dd>{Math.round(hover.gs)} kt</dd>
              <dt>Wind</dt>
              <dd>
                {String(Math.round(hover.windDir / 5) * 5 || 360).padStart(3, '0')}° / {Math.round(hover.windSpd)} kt, {Math.abs(Math.round(hover.tail))} {hover.tail >= 0 ? 'tail' : 'head'}
              </dd>
              <dt>To touchdown</dt>
              <dd>{fmtDuration(hover.t)}</dd>
            </dl>
            <p className="tip-mode" style={{ color: PATH_COLORS[pathKind(hover)] }}>
              {describeSample(hover)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export const ProfileChart = memo(ProfileChartImpl);
