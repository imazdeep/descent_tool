import { memo } from 'react';
import { FT_PER_NM } from '../lib/atmosphere';
import { sampleAt } from '../lib/descent';
import { fmtAlt, fmtAngle, fmtDist, fmtVs } from '../lib/format';
import type { DescentResult, Settings } from '../lib/types';
import { AltField, NumField } from './fields';

export interface PositionState {
  refId: string;
  dist: number | null;
  alt: number | null;
}

interface Props {
  settings: Settings;
  result: DescentResult;
  pos: PositionState;
  onChange: (patch: Partial<PositionState>) => void;
}

/** Distance to go for the entered position, or null until it is filled in. */
export function positionDistance(result: DescentResult, pos: PositionState): number | null {
  if (pos.dist == null || pos.alt == null) return null;
  const ref = result.nodes.find((n) => n.id === pos.refId) ?? result.nodes[result.nodes.length - 1];
  if (!ref) return null;
  return Math.min(result.totalDist, Math.max(0, ref.distToGo + pos.dist));
}

function PositionCheckImpl({ settings, result, pos, onChange }: Props) {
  const tl = settings.transLevel;
  const refs = result.nodes.filter((n) => n.kind !== 'custom');
  const refId = refs.some((n) => n.id === pos.refId) ? pos.refId : refs[refs.length - 1].id;
  const d = positionDistance(result, { ...pos, refId });
  const here = d != null ? sampleAt(result.samples, d) : null;

  let answer = null;
  if (d != null && here && pos.alt != null) {
    const dev = pos.alt - here.alt;
    const size = (Math.round(Math.abs(dev) / 50) * 50).toLocaleString('en-US');
    const tone = Math.abs(dev) < 150 ? 'ok' : Math.abs(dev) < 1000 ? 'warn' : 'bad';
    const headline = Math.abs(dev) < 150 ? 'On the path' : `${size} ft ${dev > 0 ? 'above' : 'below'} the path`;

    // the next altitude that has to be made: a restricted fix, or the glidepath intercept
    const ahead = result.nodes
      .filter((n) => n.distToGo < d - 0.5 && n.distToGo > result.fapDist && n.restriction.altType !== 'none' && n.restriction.alt1 != null)
      .sort((a, b) => b.distToGo - a.distToGo)[0];
    const target = ahead
      ? { name: ahead.ident, d: ahead.distToGo, alt: result.fixes[ahead.id].alt }
      : { name: 'the final approach', d: result.fapDist, alt: sampleAt(result.samples, result.fapDist)!.alt };
    const run = d - target.d;
    const drop = pos.alt - target.alt;
    const grad = run > 0.3 ? drop / run : 0;
    const angle = (Math.atan(grad / FT_PER_NM) * 180) / Math.PI;
    const vs = -(grad * here.gs) / 60;

    let advice: string;
    if (run <= 0.3) advice = 'You are on the final approach.';
    else if (drop <= 0) advice = `You are already at or below ${fmtAlt(target.alt, tl)} for ${target.name}. Fly level for ${fmtDist(run)} NM.`;
    else if (dev < -150) {
      const hit = result.samples.find((s) => s.d < d && s.alt <= pos.alt!);
      advice = hit ? `Fly level for ${fmtDist(d - hit.d)} NM, then follow the path down.` : 'Fly level until the path comes down to you.';
    } else
      advice = `To reach ${target.name} at ${fmtAlt(target.alt, tl)} you need ${fmtVs(vs)} ft/min (${fmtAngle(angle)}) over the next ${fmtDist(run)} NM.`;

    answer = (
      <div className={`pos-answer pos-${tone}`} role="status">
        <strong>{headline}</strong>
        <p>
          The path is at {fmtAlt(here.alt, tl)} here. {advice}
        </p>
      </div>
    );
  }

  return (
    <section className="card" aria-labelledby="pos-title">
      <header className="card-head">
        <div>
          <h2 id="pos-title">Am I on the path?</h2>
          <p className="card-sub">Enter where you are now.</p>
        </div>
        {(pos.dist != null || pos.alt != null) && (
          <button type="button" className="btn btn-text" onClick={() => onChange({ dist: null, alt: null })}>
            Clear
          </button>
        )}
      </header>
      <div className="pos-form">
        <NumField ariaLabel="Distance from the fix" unit="NM" value={pos.dist} min={0} max={500} decimals={1} width={104} allowEmpty placeholder="85" onChange={(v) => onChange({ dist: v })} />
        <span>before</span>
        <select className="sel" aria-label="Fix" value={refId} onChange={(e) => onChange({ refId: e.target.value })}>
          {refs
            .slice()
            .reverse()
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.ident}
              </option>
            ))}
        </select>
        <span>at</span>
        <AltField ariaLabel="Your altitude" value={pos.alt} transLevel={tl} width={104} allowEmpty placeholder="FL300" onChange={(v) => onChange({ alt: v })} />
      </div>
      {answer}
    </section>
  );
}

export const PositionCheck = memo(PositionCheckImpl);
