import { useEffect, useRef } from 'react';
import { AIRCRAFT, isKnownType } from '../lib/aircraft';
import type { FlightPlan, Settings, WindMode } from '../lib/types';
import { AltField, NumField, Segmented, Toggle } from './fields';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  pilot: string;
  loading: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onLoad: (pilot: string) => void;
  onClose: () => void;
}

export function SettingsDrawer({ plan, settings: s, pilot, loading, onChange, onReset, onLoad, onClose }: Props) {
  const tl = s.transLevel;
  const panel = useRef<HTMLDivElement>(null);
  const pilotInput = useRef<HTMLInputElement>(null);
  const num = (key: keyof Settings) => (v: number | null) => {
    if (v != null) onChange({ [key]: v } as Partial<Settings>);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drawer-wrap">
      <div className="drawer-shade" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={panel}>
        <header className="drawer-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="btn btn-text" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="drawer-body">
          <p className="drawer-intro">Everything here was filled in from your flight plan. Change what differs today.</p>

          <section>
            <h3>Aircraft</h3>
            <label className="labelled">
              <span className="labelled-text">Type</span>
              <select className="sel sel-wide" value={s.aircraftId} onChange={(e) => onChange({ aircraftId: e.target.value })}>
                {AIRCRAFT.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {!isKnownType(plan.aircraft.icao) && <p className="hint hint-warn">{plan.aircraft.icao || 'This type'} is not in the list. Pick the closest one.</p>}
            <NumField label="Landing weight" unit="kg" value={s.weightKg} min={5000} max={600000} onChange={num('weightKg')} />
          </section>

          <section>
            <h3>Descent speeds</h3>
            <div className="pair">
              <AltField label="Cruise level" value={s.cruiseAlt} transLevel={0} onChange={num('cruiseAlt')} />
              <NumField label="Mach" value={s.desMach} min={0.4} max={0.92} decimals={2} onChange={num('desMach')} />
            </div>
            <div className="pair">
              <NumField label="Speed" unit="kt" value={s.desCas} min={180} max={360} onChange={num('desCas')} />
              <NumField label={`Below ${s.limitAlt >= tl ? `FL${Math.round(s.limitAlt / 100)}` : `${s.limitAlt} ft`}`} unit="kt" value={s.limitSpeed} min={160} max={360} onChange={num('limitSpeed')} />
            </div>
          </section>

          <section>
            <h3>Approach, runway {plan.dest.runway}</h3>
            <div className="pair">
              <AltField label="Glidepath from" value={s.finalAlt} transLevel={tl} onChange={num('finalAlt')} />
              <NumField label="Approach speed" unit="kt" value={s.vapp} min={90} max={200} onChange={num('vapp')} />
            </div>
            <NumField label="Extra track miles for vectors" unit="NM" value={s.extraMiles} min={0} max={100} decimals={1} onChange={num('extraMiles')} />
          </section>

          <section>
            <h3>Wind</h3>
            <Segmented<WindMode>
              label="Wind source"
              value={s.windMode}
              onChange={(v) => onChange({ windMode: v })}
              options={[
                { value: 'plan', label: 'Flight plan' },
                { value: 'manual', label: 'My own' },
                { value: 'calm', label: 'Calm' },
              ]}
            />
            {s.windMode === 'plan' && <p className="hint">Forecast wind and temperature at every fix and level, from SimBrief.</p>}
            {s.windMode === 'manual' && (
              <table className="wind-table">
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">From</th>
                    <th scope="col">Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {s.manualWinds.map((w, i) => {
                    const patch = (p: Partial<typeof w>) => onChange({ manualWinds: s.manualWinds.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                    return (
                      <tr key={i}>
                        <td>
                          <AltField ariaLabel={`Wind level ${i + 1}`} value={w.alt} transLevel={tl} onChange={(v) => v != null && patch({ alt: v })} />
                        </td>
                        <td>
                          <NumField ariaLabel={`Wind direction at level ${i + 1}`} unit="°" value={w.dir} min={0} max={360} onChange={(v) => v != null && patch({ dir: v })} />
                        </td>
                        <td>
                          <NumField ariaLabel={`Wind speed at level ${i + 1}`} unit="kt" value={w.spd} min={0} max={250} onChange={(v) => v != null && patch({ spd: v })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <details className="more">
            <summary>Fine tuning</summary>
            <div className="more-body">
              <div className="pair">
                <NumField label="Drag, % of standard" unit="%" value={Math.round(s.dragFactor * 100)} min={60} max={160} onChange={(v) => v != null && onChange({ dragFactor: v / 100 })} />
                <NumField label="Rate while slowing" unit="ft/min" value={s.decelVs} min={0} max={1500} onChange={num('decelVs')} />
              </div>
              <div className="pair">
                <NumField label="Runway elevation" unit="ft" value={s.runwayElev} min={-1500} max={15000} onChange={num('runwayElev')} />
                <NumField label="Glidepath angle" unit="°" value={s.gpAngle} min={2} max={6} decimals={1} onChange={num('gpAngle')} />
              </div>
              <div className="pair">
                <NumField label="Speed at glidepath" unit="kt" value={s.finalSpeed} min={110} max={250} onChange={num('finalSpeed')} />
                <AltField label="Speed limit below" value={s.limitAlt} transLevel={tl} onChange={num('limitAlt')} />
              </div>
              <div className="pair">
                <AltField label="Transition level" value={s.transLevel} transLevel={0} onChange={num('transLevel')} />
                {s.windMode !== 'plan' ? <NumField label="ISA deviation" unit="°C" value={s.isaDev} min={-40} max={40} onChange={num('isaDev')} /> : <span />}
              </div>
              <Toggle checked={s.antiIce} onChange={(v) => onChange({ antiIce: v })} label="Engine anti-ice on" />
              <p className="hint">A higher drag figure steepens the path. Anti-ice raises idle thrust and makes it shallower.</p>
            </div>
          </details>

          <section>
            <h3>SimBrief</h3>
            <form
              className="pilot-form"
              onSubmit={(e) => {
                e.preventDefault();
                const v = pilotInput.current?.value.trim();
                if (v) onLoad(v);
              }}
            >
              <label className="labelled">
                <span className="labelled-text">Pilot ID or username</span>
                <span className="field">
                  <input ref={pilotInput} defaultValue={pilot} spellCheck={false} autoComplete="off" />
                </span>
              </label>
              <button type="submit" className="btn" disabled={loading}>
                {loading ? 'Loading' : 'Load flight plan'}
              </button>
            </form>
          </section>
        </div>

        <footer className="drawer-foot">
          <button type="button" className="btn btn-text" onClick={onReset}>
            Reset to flight plan values
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
