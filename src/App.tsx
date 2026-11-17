import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PositionCheck, positionDistance, type PositionState } from './components/PositionCheck';
import { ProfileChart, type ChartRange } from './components/ProfileChart';
import { RouteMap } from './components/RouteMap';
import { SettingsDrawer } from './components/SettingsDrawer';
import { Waypoints } from './components/Waypoints';
import { Segmented } from './components/fields';
import { computeDescent, defaultSettings, hasRestriction } from './lib/descent';
import { fmtDist, fmtUtc } from './lib/format';
import { fetchFlightPlan } from './lib/simbrief';
import type { CustomPoint, DescentResult, FlightPlan, Restriction, Settings } from './lib/types';

const STORE_KEY = 'descent-planner/v2';
const THEME_KEY = 'descent-planner/theme';
const DEFAULT_PILOT = '1149288';

type Theme = 'light' | 'dark';

interface Saved {
  pilot: string;
  plan: FlightPlan | null;
  settings: Settings | null;
  restrictions: Record<string, Restriction>;
  customs: CustomPoint[];
  pos: PositionState;
}

const emptyPos: PositionState = { refId: '', dist: null, alt: null };

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

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Planned clock time over the top of descent, read off the SimBrief times either side of it. */
function todTime(plan: FlightPlan, result: DescentResult): string | null {
  if (!result.tod || plan.estOff == null) return null;
  const timed = result.nodes.filter((n) => n.planTime != null);
  for (let i = 0; i < timed.length - 1; i++) {
    const a = timed[i];
    const b = timed[i + 1];
    if (a.distToGo >= result.tod.d && b.distToGo <= result.tod.d) {
      const f = (a.distToGo - result.tod.d) / (a.distToGo - b.distToGo || 1);
      return fmtUtc(plan.estOff + a.planTime! + (b.planTime! - a.planTime!) * f);
    }
  }
  return null;
}

function Hero({ plan, result, anyRestriction }: { plan: FlightPlan; result: DescentResult; anyRestriction: boolean }) {
  const { tod } = result;
  const time = todTime(plan, result);
  const minutes = Math.round(result.descentTime / 60);
  return (
    <section className="hero" aria-label="Top of descent">
      <p className="hero-label">Start your descent</p>
      {tod ? (
        <>
          <p className="hero-num">
            {tod.d.toFixed(1)}
            <span>NM before {plan.dest.icao}</span>
          </p>
          <p className="hero-sub">
            {Math.abs(tod.refOffset) < 0.3 ? `Over ${tod.refIdent}` : `${fmtDist(tod.refOffset)} NM before ${tod.refIdent}`}
            {time ? `, planned for ${time}` : ''}. Touchdown about {minutes} minutes later.
          </p>
        </>
      ) : (
        <>
          <p className="hero-num">Now</p>
          <p className="hero-sub">The path is already below your cruise level.</p>
        </>
      )}
      {result.warnings.length > 0 ? (
        <ul className="notes">
          {result.warnings.slice(0, 4).map((w, i) => (
            <li key={i} className={w.level === 'warning' ? 'note-bad' : 'note-warn'}>
              {w.text}
            </li>
          ))}
        </ul>
      ) : (
        anyRestriction && <p className="hero-ok">Every restriction is met at idle thrust.</p>
      )}
    </section>
  );
}

export default function App() {
  const [state, setState] = useState<Saved>(load);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [hoverD, setHoverD] = useState<number | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [tab, setTab] = useState<'profile' | 'map'>('profile');
  const [range, setRange] = useState<ChartRange>('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pilotDraft, setPilotDraft] = useState(state.pilot);
  const started = useRef(false);

  // a layout effect, so the map reads the new colours when its own effects run
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

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
    try {
      const plan = await fetchFlightPlan(pilot);
      setState((prev) => {
        const same = prev.plan?.id === plan.id;
        return {
          pilot,
          plan,
          settings: same && prev.settings ? prev.settings : defaultSettings(plan),
          restrictions: same ? prev.restrictions : {},
          customs: same ? prev.customs : [],
          pos: same ? prev.pos : emptyPos,
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

  const result = useMemo(() => (plan && settings ? computeDescent(plan, settings, restrictions, customs) : null), [plan, settings, restrictions, customs]);

  const onSettings = useCallback((patch: Partial<Settings>) => setState((p) => (p.settings ? { ...p, settings: { ...p.settings, ...patch } } : p)), []);
  const onReset = useCallback(() => setState((p) => (p.plan ? { ...p, settings: defaultSettings(p.plan) } : p)), []);
  const onRestriction = useCallback((id: string, r: Restriction) => setState((p) => ({ ...p, restrictions: { ...p.restrictions, [id]: r } })), []);
  const onAddCustom = useCallback(
    (c: CustomPoint) => setState((p) => ({ ...p, customs: [...p.customs, c], restrictions: { ...p.restrictions, [c.id]: { altType: 'at', alt1: null, alt2: null, speed: null } } })),
    [],
  );
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
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const ownship = useMemo(() => {
    if (!result || pos.alt == null) return null;
    const d = positionDistance(result, pos);
    return d == null ? null : { d, alt: pos.alt };
  }, [result, pos]);

  const anyRestriction = Object.values(restrictions).some(hasRestriction);

  return (
    <div className="app">
      <header className="top">
        <p className="top-brand">Descent Planner</p>
        {plan && (
          <p className="top-flight">
            <strong>{plan.callsign}</strong>
            {plan.origin.icao} to {plan.dest.icao}
            <span>
              {[plan.aircraft.icao, plan.star, plan.dest.runway && `runway ${plan.dest.runway}`].filter(Boolean).join(', ')}
            </span>
          </p>
        )}
        <div className="top-actions">
          {plan && (
            <>
              <button type="button" className="btn" disabled={status === 'loading'} onClick={() => void loadPlan(state.pilot)}>
                {status === 'loading' ? 'Loading' : 'Reload plan'}
              </button>
              <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
                Settings
              </button>
            </>
          )}
          <button type="button" className="btn btn-icon" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="3.2" fill="currentColor" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13.5 9.8A6 6 0 0 1 6.2 2.5a6 6 0 1 0 7.3 7.3Z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {status === 'error' && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}

      {!plan && (
        <main className="empty">
          <h1>{status === 'loading' ? 'Fetching your flight plan' : 'Load your SimBrief flight plan'}</h1>
          <p>The route, winds, weight and arrival come from your latest SimBrief dispatch.</p>
          <form
            className="empty-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (pilotDraft.trim()) void loadPlan(pilotDraft.trim());
            }}
          >
            <label className="labelled">
              <span className="labelled-text">Pilot ID or username</span>
              <span className="field">
                <input value={pilotDraft} onChange={(e) => setPilotDraft(e.target.value)} spellCheck={false} autoComplete="off" />
              </span>
            </label>
            <button type="submit" className="btn btn-primary" disabled={status === 'loading' || !pilotDraft.trim()}>
              {status === 'loading' ? 'Loading' : 'Load flight plan'}
            </button>
          </form>
        </main>
      )}

      {plan && settings && result && (
        <main className="main">
          <Hero plan={plan} result={result} anyRestriction={anyRestriction} />

          <section className="card" aria-label="Descent path">
            <header className="card-head card-head-tools">
              <Segmented
                label="View"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'profile', label: 'Profile' },
                  { value: 'map', label: 'Map' },
                ]}
              />
              {tab === 'profile' && (
                <Segmented<ChartRange>
                  label="Distance shown"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: 'all', label: 'Whole descent' },
                    { value: '60', label: 'Last 60 NM' },
                    { value: '25', label: 'Last 25 NM' },
                  ]}
                />
              )}
            </header>
            {tab === 'profile' ? (
              <ProfileChart plan={plan} settings={settings} result={result} range={range} hoverD={hoverD} onHover={setHoverD} ownship={ownship} />
            ) : (
              <RouteMap plan={plan} settings={settings} result={result} theme={theme} hoverD={hoverD} ownship={ownship} />
            )}
          </section>

          <Waypoints
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

          <PositionCheck settings={settings} result={result} pos={pos} onChange={onPos} />

          <footer className="foot">For flight simulation only. Performance is estimated per aircraft type, so treat the path as a plan and adjust the drag figure in Settings if your aircraft comes down steeper or shallower.</footer>
        </main>
      )}

      {settingsOpen && plan && settings && (
        <SettingsDrawer
          plan={plan}
          settings={settings}
          pilot={state.pilot}
          loading={status === 'loading'}
          onChange={onSettings}
          onReset={onReset}
          onLoad={(p) => void loadPlan(p)}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}
