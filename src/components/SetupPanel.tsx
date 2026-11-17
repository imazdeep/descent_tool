import { memo } from 'react';
import { AIRCRAFT, isKnownType } from '../lib/aircraft';
import type { FlightPlan, Settings, WindMode } from '../lib/types';
import { AltField, NumField, Segmented, Toggle } from './fields';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
}

function SetupPanelImpl({ plan, settings: s, onChange, onReset }: Props) {
  const tl = s.transLevel;
  const num = (key: keyof Settings) => (v: number | null) => {
    if (v != null) onChange({ [key]: v } as Partial<Settings>);
  };
  const known = isKnownType(plan.aircraft.icao);

  return (
    <section className="panel setup-panel" aria-label="Setup">
      <header className="panel-head">
        <div>
          <h2>Setup</h2>
          <p className="panel-sub">Filled in from the flight plan. Change anything that differs today.</p>
        </div>
        <button type="button" className="btn btn-quiet" onClick={onReset}>
          Reset to flight plan
        </button>
      </header>

      <div className="setup-grid">
        <fieldset>
          <legend>Aircraft</legend>
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
          {!known && (
            <p className="hint hint-caution">
              {plan.aircraft.icao || 'This type'} is not in the performance list. Pick the closest type and trim it with the drag setting.
            </p>
          )}
          <NumField label="Landing weight" unit="kg" value={s.weightKg} min={5000} max={600000} onChange={num('weightKg')} />
          <NumField label="Drag, percent of book" unit="%" value={Math.round(s.dragFactor * 100)} min={60} max={160} onChange={(v) => v != null && onChange({ dragFactor: v / 100 })} />
          <Toggle checked={s.antiIce} onChange={(v) => onChange({ antiIce: v })} label="Engine anti-ice on (higher idle)" />
        </fieldset>

        <fieldset>
          <legend>Speeds and levels</legend>
          <AltField label="Cruise level" value={s.cruiseAlt} transLevel={0} onChange={num('cruiseAlt')} />
          <NumField label="Descent Mach" value={s.desMach} min={0.4} max={0.92} decimals={2} onChange={num('desMach')} />
          <NumField label="Descent speed" unit="kt" value={s.desCas} min={180} max={360} onChange={num('desCas')} />
          <div className="pair">
            <NumField label="Speed limit" unit="kt" value={s.limitSpeed} min={160} max={360} onChange={num('limitSpeed')} />
            <AltField label="below" value={s.limitAlt} transLevel={tl} onChange={num('limitAlt')} />
          </div>
          <AltField label="Transition level" value={s.transLevel} transLevel={0} onChange={num('transLevel')} />
        </fieldset>

        <fieldset>
          <legend>Approach to runway {plan.dest.runway}</legend>
          <NumField label="Threshold elevation" unit="ft" value={s.runwayElev} min={-1500} max={15000} onChange={num('runwayElev')} />
          <NumField label="Glidepath angle" unit="°" value={s.gpAngle} min={2} max={6} decimals={1} onChange={num('gpAngle')} />
          <AltField label="Glidepath intercept altitude" value={s.finalAlt} transLevel={tl} onChange={num('finalAlt')} />
          <NumField label="Speed at intercept" unit="kt" value={s.finalSpeed} min={110} max={250} onChange={num('finalSpeed')} />
          <NumField label="Approach speed" unit="kt" value={s.vapp} min={90} max={200} onChange={num('vapp')} />
        </fieldset>

        <fieldset>
          <legend>Path</legend>
          <NumField label="Extra track miles (vectors)" unit="NM" value={s.extraMiles} min={0} max={100} decimals={1} onChange={num('extraMiles')} />
          <NumField label="Descent rate while slowing down" unit="ft/min" value={s.decelVs} min={0} max={1500} onChange={num('decelVs')} />
          <p className="hint">
            Extra track miles are added before the airport, for a longer final or radar vectors. Use 0 ft/min to slow down in level flight.
          </p>
        </fieldset>

        <fieldset className="wind-set">
          <legend>Wind and temperature</legend>
          <Segmented<WindMode>
            label="Wind source"
            value={s.windMode}
            onChange={(v) => onChange({ windMode: v })}
            options={[
              { value: 'plan', label: 'Flight plan winds' },
              { value: 'manual', label: 'My winds' },
              { value: 'calm', label: 'Calm' },
            ]}
          />
          {s.windMode === 'plan' && <p className="hint">Winds and temperatures come from the SimBrief forecast at every fix and level.</p>}
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
                        <AltField ariaLabel={`Wind level ${i + 1}`} value={w.alt} transLevel={tl} width={86} onChange={(v) => v != null && patch({ alt: v })} />
                      </td>
                      <td>
                        <NumField ariaLabel={`Wind direction at level ${i + 1}`} unit="°" value={w.dir} min={0} max={360} width={78} onChange={(v) => v != null && patch({ dir: v })} />
                      </td>
                      <td>
                        <NumField ariaLabel={`Wind speed at level ${i + 1}`} unit="kt" value={w.spd} min={0} max={250} width={78} onChange={(v) => v != null && patch({ spd: v })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {s.windMode !== 'plan' && <NumField label="Temperature, ISA deviation" unit="°C" value={s.isaDev} min={-40} max={40} onChange={num('isaDev')} />}
        </fieldset>
      </div>
    </section>
  );
}

export const SetupPanel = memo(SetupPanelImpl);
