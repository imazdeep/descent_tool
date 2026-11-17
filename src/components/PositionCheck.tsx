import { memo } from 'react';
import { sampleAt } from '../lib/descent';
import { describeRestriction, fmtAlt, fmtAngle, fmtDist, fmtVs } from '../lib/format';
import { FT_PER_NM } from '../lib/atmosphere';
import type { DescentResult, Settings } from '../lib/types';
import { AltField, NumField, Toggle } from './fields';

export interface PositionState {
  on: boolean;
  refId: string;
  dist: number;
  alt: number;
  gs: number | null;
}

interface Props {
  settings: Settings;
  result: DescentResult;
  pos: PositionState;
  onChange: (patch: Partial<PositionState>) => void;
}

/** Distance to go for the position, or null when the reference fix is gone. */
export function positionDistance(result: DescentResult, pos: PositionState): number | null {
  const ref = result.nodes.find((n) => n.id === pos.refId) ?? result.nodes[result.nodes.length - 1];
  if (!ref) return null;
  return Math.min(result.totalDist, Math.max(0, ref.distToGo + pos.dist));
}

function PositionCheckImpl({ settings, result, pos, onChange }: Props) {
  const tl = settings.transLevel;
  const d = positionDistance(result, pos);
  const refs = result.nodes.filter((n) => n.kind !== 'custom');
  const here = d != null ? sampleAt(result.samples, d) : null;

  let body = null;
  if (pos.on && d != null && here) {
    const gs = pos.gs ?? Math.round(here.gs);
    const dev = pos.alt - here.alt;
    const devText = Math.abs(dev) < 150 ? 'On the path' : `${(Math.round(Math.abs(dev) / 50) * 50).toLocaleString('en-US')} ft ${dev > 0 ? 'high' : 'low'}`;
    const devClass = Math.abs(dev) < 150 ? 'ok' : Math.abs(dev) < 1000 ? 'caution' : 'bad';

    // next point ahead that fixes an altitude: a restricted fix or the glidepath intercept
    const ahead = result.nodes
      .filter((n) => n.distToGo < d - 0.5 && n.distToGo > result.fapDist && n.restriction.altType !== 'none' && n.restriction.alt1 != null)
      .sort((a, b) => b.distToGo - a.distToGo)[0];
    const target = ahead
      ? { name: ahead.ident, d: ahead.distToGo, alt: result.fixes[ahead.id].alt, what: describeRestriction({ ...ahead.restriction, speed: null }, tl) }
      : { name: 'the glidepath intercept', d: result.fapDist, alt: sampleAt(result.samples, result.fapDist)!.alt, what: '' };
    const run = d - target.d;
    const drop = pos.alt - target.alt;
    const grad = run > 0.3 ? drop / run : 0;
    const angle = (Math.atan(grad / FT_PER_NM) * 180) / Math.PI;
    const vs = -(grad * gs) / 60;

    // where a level flight from here would meet the path again
    let rejoin: number | null = null;
    if (dev < -150) {
      const hit = result.samples.find((s) => s.d < d && s.alt <= pos.alt);
      if (hit) rejoin = d - hit.d;
    }

    body = (
      <div className="pos-out">
        <div className={`pos-dev pos-${devClass}`}>
          <strong>{devText}</strong>
          <span>
            The path is at {fmtAlt(here.alt, tl)} here, {fmtDist(d)} NM to run
          </span>
        </div>
        <dl className="pos-list">
          {run > 0.3 && drop > 0 && (
            <>
              <dt>
                To cross {target.name} at {fmtAlt(target.alt, tl)}
                {target.what ? ` (${target.what})` : ''}
              </dt>
              <dd>
                <b>{fmtVs(vs)} ft/min</b> at {gs} kt ground speed, {fmtAngle(angle)}, over {fmtDist(run)} NM
              </dd>
            </>
          )}
          {run > 0.3 && drop <= 0 && (
            <>
              <dt>Next altitude target</dt>
              <dd>
                You are already at or below {fmtAlt(target.alt, tl)} for {target.name}. Stay level for {fmtDist(run)} NM.
              </dd>
            </>
          )}
          {rejoin != null && (
            <>
              <dt>Below the path</dt>
              <dd>
                Fly level for <b>{fmtDist(rejoin)} NM</b>, then follow the path down.
              </dd>
            </>
          )}
          {dev > 150 && (
            <>
              <dt>Above the path</dt>
              <dd>
                The planned rate here is {fmtVs(here.vs)} ft/min. Add speedbrake or speed to steepen, or ask for more track miles: about <b>{fmtDist(dev / Math.max(150, result.avgGradient))} NM</b> would absorb it.
              </dd>
            </>
          )}
        </dl>
      </div>
    );
  }

  return (
    <section className="panel pos-panel" aria-label="Position check">
      <header className="panel-head">
        <div>
          <h2>Position check</h2>
          <p className="panel-sub">Enter where you are to see how you sit against the path.</p>
        </div>
        <Toggle checked={pos.on} onChange={(v) => onChange({ on: v })} label="Show" />
      </header>
      {pos.on && (
        <>
          <div className="pos-inputs">
            <NumField label="Distance" unit="NM" value={pos.dist} min={0} max={500} decimals={1} onChange={(v) => v != null && onChange({ dist: v })} />
            <label className="labelled">
              <span className="labelled-text">before</span>
              <select className="sel sel-wide" value={result.nodes.some((n) => n.id === pos.refId) ? pos.refId : refs[refs.length - 1].id} onChange={(e) => onChange({ refId: e.target.value })}>
                {refs
                  .slice()
                  .reverse()
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.ident}
                    </option>
                  ))}
              </select>
            </label>
            <AltField label="Altitude" value={pos.alt} transLevel={tl} onChange={(v) => v != null && onChange({ alt: v })} />
            <NumField label="Ground speed" unit="kt" value={pos.gs} min={60} max={700} allowEmpty placeholder={here ? String(Math.round(here.gs)) : ''} onChange={(v) => onChange({ gs: v })} />
          </div>
          {body}
        </>
      )}
    </section>
  );
}

export const PositionCheck = memo(PositionCheckImpl);
