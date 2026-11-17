import { memo } from 'react';
import { sampleAt } from '../lib/descent';
import { fmtAlt, fmtDist, fmtMinutes, fmtUtc, fmtVs } from '../lib/format';
import { FT_PER_NM } from '../lib/atmosphere';
import type { DescentResult, FlightPlan, Settings } from '../lib/types';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  result: DescentResult;
}

function SummaryImpl({ plan, settings, result }: Props) {
  const { tod, nodes } = result;
  const tl = settings.transLevel;

  let eta: string | null = null;
  if (tod && plan.estOff != null) {
    // planned time over the top of descent, read off the SimBrief times either side
    const timed = nodes.filter((n) => n.planTime != null);
    for (let i = 0; i < timed.length - 1; i++) {
      const a = timed[i];
      const b = timed[i + 1];
      if (a.distToGo >= tod.d && b.distToGo <= tod.d) {
        const f = (a.distToGo - tod.d) / (a.distToGo - b.distToGo || 1);
        eta = fmtUtc(plan.estOff + a.planTime! + (b.planTime! - a.planTime!) * f);
        break;
      }
    }
  }

  const first = tod ? sampleAt(result.samples, tod.d - 3) : null;
  const sbDelta = tod && plan.sbTodDistToGo != null ? tod.d - (plan.sbTodDistToGo + (settings.extraMiles || 0)) : null;
  const angle = (Math.atan(result.avgGradient / FT_PER_NM) * 180) / Math.PI;
  const cautions = result.warnings.filter((w) => w.level === 'caution').length;
  const warnings = result.warnings.filter((w) => w.level === 'warning').length;

  return (
    <section className="summary" aria-label="Descent summary">
      <div className="summary-lead">
        {tod ? (
          <>
            <p className="summary-kicker">Start down</p>
            <p className="summary-big">
              {tod.d.toFixed(1)} <span>NM from {plan.dest.icao}</span>
            </p>
            <p className="summary-where">
              {Math.abs(tod.refOffset) < 0.3 ? `Over ${tod.refIdent}` : `${fmtDist(tod.refOffset)} NM before ${tod.refIdent}`}
              {eta ? `, planned ${eta}` : ''}
            </p>
          </>
        ) : (
          <>
            <p className="summary-kicker">Start down</p>
            <p className="summary-big">Now</p>
            <p className="summary-where">The path is already below the cruise level.</p>
          </>
        )}
      </div>

      <dl className="summary-stats">
        <div>
          <dt>From</dt>
          <dd>{fmtAlt(settings.cruiseAlt, tl)}</dd>
          <dd className="sub">to {fmtAlt(settings.runwayElev, tl)} at the runway</dd>
        </div>
        <div>
          <dt>Descent time</dt>
          <dd>{fmtMinutes(result.descentTime)}</dd>
          <dd className="sub">top of descent to touchdown</dd>
        </div>
        <div>
          <dt>First rate</dt>
          <dd>{first ? `${fmtVs(first.vs)}` : ''}</dd>
          <dd className="sub">ft/min leaving cruise</dd>
        </div>
        <div>
          <dt>Average path</dt>
          <dd>{angle.toFixed(1)}°</dd>
          <dd className="sub">{Math.round(result.avgGradient)} ft per NM</dd>
        </div>
        <div>
          <dt>Against SimBrief</dt>
          <dd>{sbDelta == null ? 'n/a' : Math.abs(sbDelta) < 0.5 ? 'Same' : `${fmtDist(Math.abs(sbDelta))} NM`}</dd>
          <dd className="sub">{sbDelta == null ? 'no planned top of descent' : Math.abs(sbDelta) < 0.5 ? 'top of descent matches' : sbDelta > 0 ? 'earlier than planned' : 'later than planned'}</dd>
        </div>
      </dl>

      <div className={`summary-flags${warnings ? ' has-warn' : cautions ? ' has-caution' : ''}`}>
        {result.warnings.length === 0 ? (
          <p className="flag flag-ok">
            <i aria-hidden="true" />
            Flyable at idle. Every restriction is met.
          </p>
        ) : (
          <ul>
            {result.warnings.slice(0, 4).map((w, i) => (
              <li key={i} className={`flag flag-${w.level}`}>
                <i aria-hidden="true" />
                {w.text}
              </li>
            ))}
            {result.warnings.length > 4 && <li className="flag-more">and {result.warnings.length - 4} more</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

export const Summary = memo(SummaryImpl);
