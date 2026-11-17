import { memo, useEffect, useState } from 'react';
import { NO_RESTRICTION, hasRestriction } from '../lib/descent';
import { capitalize, describeRestriction, fmtAlt, fmtDist, fmtSpeed } from '../lib/format';
import type { AltType, CustomPoint, DescentResult, FlightPlan, Restriction, Settings } from '../lib/types';
import { AltField, NumField, Segmented } from './fields';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  result: DescentResult;
  restrictions: Record<string, Restriction>;
  hoverD: number | null;
  onHover: (d: number | null) => void;
  onRestriction: (id: string, r: Restriction) => void;
  onAddCustom: (c: CustomPoint) => void;
  onRemoveCustom: (id: string) => void;
  onClear: () => void;
}

const TYPES: { value: AltType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'at', label: 'At' },
  { value: 'above', label: 'At or above' },
  { value: 'below', label: 'At or below' },
  { value: 'between', label: 'Between' },
];

function useNarrow(): boolean {
  const query = '(max-width: 640px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

function WaypointsImpl({ plan, settings, result, restrictions, hoverD, onHover, onRestriction, onAddCustom, onRemoveCustom, onClear }: Props) {
  const tl = settings.transLevel;
  const narrow = useNarrow();
  const cols = narrow ? 4 : 5;
  const [editing, setEditing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addRef, setAddRef] = useState('');
  const [addDist, setAddDist] = useState<number | null>(10);
  const [addSide, setAddSide] = useState<'before' | 'after'>('before');

  const todD = result.tod?.d ?? result.totalDist;
  const horizon = todD + 30;
  const rows = result.nodes.filter((n) => showAll || n.distToGo <= horizon || hasRestriction(restrictions[n.id]));
  const hidden = result.nodes.length - rows.length;
  const refOptions = result.nodes.filter((n) => n.kind === 'fix' && n.distToGo <= horizon + 60);
  const refId = addRef && refOptions.some((n) => n.id === addRef) ? addRef : (refOptions.find((n) => n.distToGo <= todD)?.id ?? refOptions[0]?.id ?? '');
  const any = Object.values(restrictions).some(hasRestriction) || result.nodes.some((n) => n.kind === 'custom');
  const nearest = hoverD != null && rows.length ? rows.reduce((best, n) => (Math.abs(n.distToGo - hoverD) < Math.abs(best.distToGo - hoverD) ? n : best), rows[0]) : null;

  return (
    <section className="card" aria-labelledby="wpt-title">
      <header className="card-head">
        <div>
          <h2 id="wpt-title">Waypoints</h2>
          <p className="card-sub">Add the altitude and speed limits from your arrival chart or from ATC. The path adjusts straight away.</p>
        </div>
        {any && (
          <button type="button" className="btn btn-text" onClick={onClear}>
            Clear all
          </button>
        )}
      </header>

      <table className={narrow ? 'wpt wpt-narrow' : 'wpt'}>
        <thead>
          <tr>
            <th scope="col">Fix</th>
            <th scope="col" className="num">
              To run
            </th>
            <th scope="col" className="num">
              Altitude
            </th>
            {!narrow && (
              <th scope="col" className="num">
                Speed
              </th>
            )}
            <th scope="col">Restriction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n, i) => {
            const r = restrictions[n.id] ?? NO_RESTRICTION;
            const f = result.fixes[n.id];
            const beforeTod = result.tod != null && n.distToGo > result.tod.d;
            const todHere = result.tod != null && !beforeTod && (i === 0 || rows[i - 1].distToGo > result.tod.d);
            const set = (patch: Partial<Restriction>) => onRestriction(n.id, { ...r, ...patch });
            const open = editing === n.id;
            const bad = f.status === 'missed' || f.status === 'conflict';
            const has = hasRestriction(r);
            return [
              todHere && result.tod ? (
                <tr key={`${n.id}-tod`} className="tod-row">
                  <td colSpan={cols}>
                    <span>Top of descent</span> {result.tod.d.toFixed(1)} NM to run
                  </td>
                </tr>
              ) : null,
              <tr
                key={n.id}
                className={`${beforeTod ? 'is-cruise ' : ''}${nearest?.id === n.id ? 'is-hover ' : ''}${open ? 'is-open' : ''}`}
                onMouseEnter={() => onHover(n.distToGo)}
                onMouseLeave={() => onHover(null)}
              >
                <th scope="row">
                  {n.kind === 'airport' ? `${n.ident} ${plan.dest.runway}` : n.ident}
                  {n.kind === 'custom' && <span className="wpt-note">added</span>}
                </th>
                <td className="num">{fmtDist(n.distToGo)}</td>
                <td className="num wpt-alt">{fmtAlt(f.alt, tl)}</td>
                {!narrow && <td className="num">{fmtSpeed(f)}</td>}
                <td>
                  {n.kind === 'airport' ? (
                    <span className="muted">Runway</span>
                  ) : (
                    <button type="button" className={has ? `restr${bad ? ' restr-bad' : ''}` : 'restr restr-empty'} aria-expanded={open} onClick={() => setEditing(open ? null : n.id)}>
                      {has ? capitalize(describeRestriction(r, tl)) : n.kind === 'custom' ? 'Set restriction' : 'Add'}
                      {has && bad && <em>{f.status === 'conflict' ? 'cannot be met' : f.note}</em>}
                    </button>
                  )}
                </td>
              </tr>,
              open ? (
                <tr key={`${n.id}-edit`} className="edit-row">
                  <td colSpan={cols}>
                    <div className="editor">
                      <div className="editor-group">
                        <span className="editor-label">Altitude</span>
                        <Segmented<AltType>
                          label={`Altitude restriction at ${n.ident}`}
                          value={r.altType}
                          options={TYPES}
                          onChange={(altType) => {
                            if (altType === 'none') set({ altType, alt1: null, alt2: null });
                            else set({ altType, alt2: altType === 'between' ? r.alt2 : null });
                          }}
                        />
                        {r.altType !== 'none' && (
                          <AltField
                            key={r.altType === 'between' ? 'lo' : 'one'}
                            ariaLabel={`${r.altType === 'between' ? 'Lower altitude' : 'Altitude'} at ${n.ident}`}
                            value={r.alt1}
                            transLevel={tl}
                            placeholder="FL100"
                            width={92}
                            allowEmpty
                            autoFocus={r.alt1 == null}
                            onChange={(v) => set({ alt1: v })}
                          />
                        )}
                        {r.altType === 'between' && (
                          <>
                            <span className="muted">and</span>
                            <AltField ariaLabel={`Upper altitude at ${n.ident}`} value={r.alt2} transLevel={tl} placeholder="FL140" width={92} allowEmpty onChange={(v) => set({ alt2: v })} />
                          </>
                        )}
                      </div>
                      <div className="editor-group">
                        <span className="editor-label">Max speed</span>
                        <NumField ariaLabel={`Maximum speed at ${n.ident}`} value={r.speed} min={120} max={360} unit="kt" placeholder="None" width={96} allowEmpty onChange={(v) => set({ speed: v })} />
                      </div>
                      <div className="editor-actions">
                        {(has || n.kind === 'custom') && (
                          <button
                            type="button"
                            className="btn btn-text"
                            onClick={() => {
                              if (n.kind === 'custom') onRemoveCustom(n.id);
                              else onRestriction(n.id, NO_RESTRICTION);
                              setEditing(null);
                            }}
                          >
                            {n.kind === 'custom' ? 'Remove point' : 'Remove'}
                          </button>
                        )}
                        <button type="button" className="btn" onClick={() => setEditing(null)}>
                          Done
                        </button>
                      </div>
                    </div>
                    {f.status === 'conflict' && <p className="editor-note">{f.note}</p>}
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>

      <footer className="card-foot">
        {adding ? (
          <form
            className="add-point"
            onSubmit={(e) => {
              e.preventDefault();
              if (!refId || addDist == null || addDist <= 0) return;
              const id = `custom-${Date.now().toString(36)}`;
              onAddCustom({ id, refId, before: addSide === 'before' ? addDist : -addDist });
              setEditing(id);
              setAdding(false);
            }}
          >
            <span>New point</span>
            <NumField ariaLabel="Distance from the fix" value={addDist} min={0.5} max={300} decimals={1} unit="NM" width={96} autoFocus onChange={setAddDist} />
            <select className="sel" aria-label="Before or after the fix" value={addSide} onChange={(e) => setAddSide(e.target.value as 'before' | 'after')}>
              <option value="before">before</option>
              <option value="after">after</option>
            </select>
            <select className="sel" aria-label="Reference fix" value={refId} onChange={(e) => setAddRef(e.target.value)}>
              {refOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.ident}
                </option>
              ))}
            </select>
            <button type="submit" className="btn">
              Add point
            </button>
            <button type="button" className="btn btn-text" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <button type="button" className="btn btn-text" onClick={() => setAdding(true)}>
              Add a point between fixes
            </button>
            {(hidden > 0 || showAll) && (
              <button type="button" className="btn btn-text" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Hide earlier fixes' : `Show ${hidden} earlier fixes`}
              </button>
            )}
          </>
        )}
      </footer>
    </section>
  );
}

export const Waypoints = memo(WaypointsImpl);
