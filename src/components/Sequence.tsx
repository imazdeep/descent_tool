import { memo } from 'react';
import { sampleAt } from '../lib/descent';
import { describeRestriction, fmtAlt, fmtDist, fmtDuration } from '../lib/format';
import type { DescentResult, FlightPlan, Settings } from '../lib/types';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  result: DescentResult;
  onHover: (d: number | null) => void;
}

interface Step {
  d: number;
  title: string;
  detail: string;
  tone: 'path' | 'restriction' | 'caution' | 'warning' | 'plain';
  /** The detail already states the altitude. */
  hasAlt?: boolean;
}

function SequenceImpl({ plan, settings, result, onHover }: Props) {
  const tl = settings.transLevel;
  const { samples, tod, markers, nodes, fixes, warnings } = result;
  const steps: Step[] = [];
  const mach = `M ${settings.desMach.toFixed(2).replace(/^0/, '')}`;
  const start = tod?.d ?? result.totalDist;

  if (tod) {
    const s = sampleAt(samples, tod.d - 1)!;
    steps.push({ d: tod.d, title: 'Top of descent', detail: `Thrust to idle, hold ${s.onMach ? mach : `${Math.round(s.cas)} kt`}`, tone: 'path' });
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (b.d > start) continue;
    if (a.onMach && !b.onMach && a.mode !== 'cruise' && !b.decel) {
      steps.push({ d: b.d, title: `Hold ${Math.round(b.cas)} kt`, detail: `Change over from ${mach}`, tone: 'path' });
      break;
    }
  }
  for (const m of markers) if (m.kind === 'decel' && m.d <= start) steps.push({ d: m.d, title: m.detail, detail: 'Shallow the path and let the speed come back', tone: 'plain' });
  for (const n of nodes) {
    const r = n.restriction;
    if (n.distToGo > start || n.distToGo <= 0) continue;
    if ((r.altType === 'none' || r.alt1 == null) && r.speed == null) continue;
    const f = fixes[n.id];
    steps.push({
      d: n.distToGo,
      title: `${n.ident}, ${describeRestriction(r, tl)}`,
      detail: f.status === 'met' ? `Crossing at ${fmtAlt(f.alt, tl)}, ${Math.round(f.cas)} kt` : f.note,
      tone: f.status === 'met' ? 'restriction' : 'warning',
      hasAlt: true,
    });
  }
  for (const w of warnings) {
    if (w.from == null || w.to == null) continue;
    steps.push({
      d: w.from,
      title: w.level === 'warning' ? 'Too steep to hold speed' : 'Speedbrake',
      detail: `For ${fmtDist(w.from - w.to)} NM`,
      tone: w.level === 'warning' ? 'warning' : 'caution',
    });
  }
  const fap = markers.find((m) => m.kind === 'fap');
  if (fap) {
    const s = sampleAt(samples, fap.d)!;
    steps.push({ d: fap.d, title: `Glidepath at ${fmtAlt(fap.alt, tl)}`, detail: `${Math.round(s.cas)} kt, ${settings.gpAngle.toFixed(1)}° down to the runway`, tone: 'plain', hasAlt: true });
  }
  const gate = settings.runwayElev + 1000;
  const stable = samples.find((s) => s.alt <= gate && s.mode === 'final');
  if (stable && fap && fap.alt > gate) steps.push({ d: stable.d, title: `Stable at ${settings.vapp} kt`, detail: `By ${fmtAlt(gate, tl)}, 1,000 ft above the runway`, tone: 'plain', hasAlt: true });
  steps.push({ d: 0, title: `Runway ${plan.dest.runway} threshold`, detail: `${plan.dest.icao} ${plan.dest.name.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())}`, tone: 'plain' });
  steps.sort((a, b) => b.d - a.d);

  return (
    <section className="panel seq-panel" aria-label="Descent sequence">
      <header className="panel-head">
        <h2>Sequence</h2>
      </header>
      <ol className="seq">
        {steps.map((st, i) => {
          const s = sampleAt(samples, st.d)!;
          return (
            <li key={i} className={`seq-${st.tone}`} onMouseEnter={() => onHover(st.d)} onMouseLeave={() => onHover(null)}>
              <div className="seq-when">
                <b>{fmtDist(st.d)}</b> NM
                <span>{fmtDuration(s.t)} to land</span>
              </div>
              <div className="seq-what">
                <strong>{st.title}</strong>
                <span>
                  {st.detail}
                  {st.d > 0 && !st.hasAlt ? `, passing ${fmtAlt(s.alt, tl)}` : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export const Sequence = memo(SequenceImpl);
