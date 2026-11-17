import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PositionCheck, positionDistance, type PositionState } from './components/PositionCheck';
import { ProfileChart } from './components/ProfileChart';
import { RestrictionTable } from './components/RestrictionTable';
import { RouteMap } from './components/RouteMap';
import { Sequence } from './components/Sequence';
import { SetupPanel } from './components/SetupPanel';
import { Summary } from './components/Summary';
import { computeDescent, defaultSettings } from './lib/descent';
import { fmtAgo, fmtAlt } from './lib/format';
import { fetchFlightPlan } from './lib/simbrief';
import type { CustomPoint, FlightPlan, Restriction, Settings } from './lib/types';

const STORE_KEY = 'descent-planner/v1';
const DEFAULT_PILOT = '1149288';

interface Saved {
  pilot: string;
  plan: FlightPlan | null;
  settings: Settings | null;
  restrictions: Record<string, Restriction>;
  customs: CustomPoint[];
  pos: PositionState;
}

const emptyPos: PositionState = { on: false, refId: '', dist: 80, alt: 30000, gs: null };

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s && typeof s.pilot === 'string') return { ...s, pos: { ...emptyPos, ...s.pos } };
    }
  } catch {
    /* storage unavailable or corrupt: start clean */
  }
  return { pilot: DEFAULT_PILOT, plan: null, settings: null, restrictions: {}, customs: [], pos: emptyPos };
}

export default function App() {
  const [state, setState] = useState<Saved>(load);
  const [pilotDraft, setPilotDraft] = useState(state.pilot);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hoverD, setHoverD] = useState<number | null>(null);
  const started = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const loadPlan = useCallback(async (pilot: string, quiet = false) => {
    if (!quiet) setStatus('loading');
    setError('');
    setNotice('');
    try {
      const plan = await fetchFlightPlan(pilot);
      setState((prev) => {
        const same = prev.plan?.id === plan.id;
        if (same && !quiet) setNotice('This is still the latest flight plan. Your restrictions are kept.');
        return {
          pilot,
          plan,
          settings: same && prev.settings ? prev.settings : defaultSettings(plan),
          restrictions: same ? prev.restrictions : {},
          customs: same ? prev.customs : [],
          pos: same ? prev.pos : { ...emptyPos, refId: plan.points[plan.points.length - 1].id, alt: plan.cruiseAlt, dist: Math.round((plan.sbTodDistToGo ?? 100) - 15) },
        };
      });
      setStatus('idle');
    } catch (e) {
      // a background refresh that fails leaves the saved plan in place
      if (quiet) return;
      setError(e instanceof Error ? e.message : 'The flight plan could not be loaded.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // always pick up the latest dispatch; a saved plan stays on screen meanwhile
    if (state.pilot) void loadPlan(state.pilot, !!state.plan);
  }, [state.plan, state.pilot, loadPlan]);

  const { plan, settings, restrictions, customs, pos } = state;

  useEffect(() => {
    document.title = plan ? `${plan.callsign} ${plan.origin.icao} to ${plan.dest.icao} | Descent Planner` : 'Descent Planner';
  }, [plan]);

  const result = useMemo(
    () => (plan && settings ? computeDescent(plan, settings, restrictions, customs) : null),
    [plan, settings, restrictions, customs],
  );

  const onSettings = useCallback((patch: Partial<Settings>) => setState((p) => (p.settings ? { ...p, settings: { ...p.settings, ...patch } } : p)), []);
  const onReset = useCallback(() => setState((p) => (p.plan ? { ...p, settings: defaultSettings(p.plan) } : p)), []);
  const onRestriction = useCallback((id: string, r: Restriction) => setState((p) => ({ ...p, restrictions: { ...p.restrictions, [id]: r } })), []);
  const onAddCustom = useCallback((c: CustomPoint) => setState((p) => ({ ...p, customs: [...p.customs, c], restrictions: { ...p.restrictions, [c.id]: { altType: 'at', alt1: null, alt2: null, speed: null } } })), []);
  const onRemoveCustom = useCallback(
    (id: string) =>
      setState((p) => {
        const { [id]: _gone, ...rest } = p.restrictions;
        return { ...p, customs: p.customs.filter((c) => c.id !== id), restrictions: rest };
      }),
    [],
  );
  const onClear = useCallback(() => setState((p) => ({ ...p, restrictions: {}, customs: [] })), []);
  const onPos = useCallback((patch: Partial<PositionState>) => setState((p) => ({ ...p, pos: { ...p.pos, ...patch } })), []);

  const ownship = useMemo(() => {
    if (!result || !pos.on) return null;
    const d = positionDistance(result, pos);
    return d == null ? null : { d, alt: pos.alt };
  }, [result, pos]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadPlan(pilotDraft.trim());
  };

  const loader = (
    <form className="loader" onSubmit={submit}>
      <label className="labelled">
        <span className="labelled-text">SimBrief pilot ID or username</span>
        <span className="field" style={{ width: 150 }}>
          <input value={pilotDraft} onChange={(e) => setPilotDraft(e.target.value)} spellCheck={false} autoComplete="off" aria-label="SimBrief pilot ID or username" />
        </span>
      </label>
      <button type="submit" className="btn btn-primary" disabled={status === 'loading' || !pilotDraft.trim()}>
        {status === 'loading' ? 'Loading' : plan ? 'Reload flight plan' : 'Load flight plan'}
      </button>
    </form>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M3 9h9l16 15" fill="none" stroke="var(--green)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 4v10" stroke="var(--magenta)" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M3 27h26" stroke="var(--cyan)" strokeWidth="1.6" strokeLinecap="round" opacity=".75" />
          </svg>
          <h1>Descent Planner</h1>
        </div>

        {plan && settings && (
          <div className="flight">
            <div className="flight-main">
              <span className="flight-call">{plan.callsign}</span>
              <span className="flight-route">
                {plan.origin.icao}
                <svg width="26" height="10" viewBox="0 0 26 10" aria-label="to">
                  <path d="M1 5h22m-5-4 5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {plan.dest.icao}
              </span>
            </div>
            <dl className="flight-meta">
              <div>
                <dt>Aircraft</dt>
                <dd>
                  {plan.aircraft.icao} {plan.aircraft.reg}
                </dd>
              </div>
              <div>
                <dt>Arrival</dt>
                <dd>{plan.star || 'none filed'}</dd>
              </div>
              <div>
                <dt>Runway</dt>
                <dd>{plan.dest.runway || 'n/a'}</dd>
              </div>
              <div>
                <dt>Cruise</dt>
                <dd>{fmtAlt(settings.cruiseAlt, 0)}</dd>
              </div>
              <div>
                <dt>Plan made</dt>
                <dd>{plan.generatedAt ? fmtAgo(plan.generatedAt) : 'unknown'}</dd>
              </div>
            </dl>
          </div>
        )}

        {loader}
      </header>

      {status === 'error' && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}
      {notice && status === 'idle' && (
        <p className="banner" role="status">
          {notice}
        </p>
      )}

      {!plan && status !== 'error' && (
        <main className="empty">
          <p className="empty-title">{status === 'loading' ? 'Fetching your latest SimBrief flight plan' : 'Load a flight plan to plan the descent'}</p>
          <p>The route, winds, weights and arrival come straight from your most recent SimBrief dispatch.</p>
        </main>
      )}

      {plan && settings && result && (
        <main className="main">
          <Summary plan={plan} settings={settings} result={result} />
          <div className="top-grid">
            <div className="primary">
              <ProfileChart plan={plan} settings={settings} result={result} hoverD={hoverD} onHover={setHoverD} ownship={ownship} />
              <RestrictionTable
                plan={plan}
                settings={settings}
                result={result}
                restrictions={restrictions}
                hoverD={hoverD}
                onHover={setHoverD}
                onRestriction={onRestriction}
                onAddCustom={onAddCustom}
                onRemoveCustom={onRemoveCustom}
                onClear={onClear}
              />
            </div>
            <div className="side">
              <RouteMap plan={plan} settings={settings} result={result} hoverD={hoverD} ownship={ownship} />
              <PositionCheck settings={settings} result={result} pos={pos} onChange={onPos} />
              <Sequence plan={plan} settings={settings} result={result} onHover={setHoverD} />
            </div>
          </div>
          <SetupPanel plan={plan} settings={settings} onChange={onSettings} onReset={onReset} />
          <footer className="foot">
            <p>
              For flight simulation only. The path comes from an approximate performance model: idle thrust and a drag polar per aircraft type, flown backwards from the runway through your restrictions with the forecast winds. Trim it against your aircraft with the drag setting.
            </p>
            {plan.dest.metar && <p className="metar">{plan.dest.metar}</p>}
          </footer>
        </main>
      )}
    </div>
  );
}
