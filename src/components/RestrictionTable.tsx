import { memo, useState } from 'react';
import { NO_RESTRICTION, hasRestriction } from '../lib/descent';
import { fmtAlt, fmtAngle, fmtDist, fmtDuration, fmtSpeed, fmtVs } from '../lib/format';
import type { AltType, CustomPoint, DescentResult, FlightPlan, Restriction, Settings } from '../lib/types';
import { AltField, NumField } from './fields';

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
  { value: 'none', label: 'No altitude' },
  { value: 'at', label: 'At' },
  { value: 'above', label: 'At or above' },
  { value: 'below', label: 'At or below' },
  { value: 'between', label: 'Between' },
];

function StatusChip({ status, note }: { status: string; note: string }) {
  if (status === 'none') return null;
  if (status === 'met') return <span className="chip chip-ok">Met</span>;
  return (
    <span className="chip chip-bad" title={note}>
      {status === 'conflict' ? 'Conflict' : note || 'Missed'}
    </span>
  );
}

function RestrictionTableImpl({ plan, settings, result, restrictions, hoverD, onHover, onRestriction, onAddCustom, onRemoveCustom, onClear }: Props) {
  const tl = settings.transLevel;
  const [showAll, setShowAll] = useState(false);
  const [focusAlt, setFocusAlt] = useState<string | null>(null);
  const [addRef, setAddRef] = useState('');
  const [addDist, setAddDist] = useState<number | null>(10);
  const [addSide, setAddSide] = useState<'before' | 'after'>('before');

  const horizon = Math.max(result.tod?.d ?? 0, plan.sbTodDistToGo ?? 0) + 45;
  const rows = result.nodes.filter((n) => showAll || n.distToGo <= horizon || hasRestriction(restrictions[n.id]));
  const hidden = result.nodes.length - rows.length;
  const refOptions = result.nodes.filter((n) => n.kind === 'fix' && n.distToGo <= horizon + 60);
  const refId = addRef && refOptions.some((n) => n.id === addRef) ? addRef : (refOptions.find((n) => n.distToGo <= (result.tod?.d ?? 0))?.id ?? refOptions[0]?.id ?? '');
  const anyRestriction = Object.values(restrictions).some(hasRestriction);
  const nearest = hoverD != null ? rows.reduce((best, n) => (Math.abs(n.distToGo - hoverD) < Math.abs(best.distToGo - hoverD) ? n : best), rows[0]) : null;

  return (
    <section className="panel table-panel" aria-label="Restrictions">
      <header className="panel-head">
        <div>
          <h2>Restrictions</h2>
          <p className="panel-sub">Type the altitude and speed limits from the arrival chart or from ATC. The path updates as you go.</p>
        </div>
        <div className="head-actions">
          {hidden > 0 || showAll ? (
            <button type="button" className="btn btn-quiet" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show descent fixes only' : `Show ${hidden} earlier fixes`}
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet" disabled={!anyRestriction} onClick={onClear}>
            Clear restrictions
          </button>
        </div>
      </header>

      <div className="table-scroll">
        <table className="rtable">
          <thead>
            <tr>
              <th scope="col">Fix</th>
              <th scope="col" className="num">
                To run
              </th>
              <th scope="col">Altitude restriction</th>
              <th scope="col">Max speed</th>
              <th scope="col" className="num sep">
                Crossing
              </th>
              <th scope="col" className="num">
                Speed
              </th>
              <th scope="col" className="num">
                V/S
              </th>
              <th scope="col" className="num">
                Angle
              </th>
              <th scope="col" className="num">
                To land
              </th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const r = restrictions[n.id] ?? NO_RESTRICTION;
              const f = result.fixes[n.id];
              const inCruise = result.tod != null && n.distToGo > result.tod.d;
              const isTodRow = result.tod != null && n.distToGo <= result.tod.d;
              const prevIdx = rows.indexOf(n) - 1;
              const todBefore = isTodRow && (prevIdx < 0 || rows[prevIdx].distToGo > (result.tod?.d ?? 0));
              const set = (patch: Partial<Restriction>) => onRestriction(n.id, { ...r, ...patch });
              return [
                todBefore && result.tod ? (
                  <tr key={`${n.id}-tod`} className="tod-row">
                    <td colSpan={10}>
                      <span className="tod-line">
                        <b>Top of descent</b> {fmtDist(result.tod.d)} NM to run, {fmtDist(Math.abs(result.tod.refOffset))} NM before {result.tod.refIdent}
                      </span>
                    </td>
                  </tr>
                ) : null,
                <tr
                  key={n.id}
                  className={`${inCruise ? 'row-cruise ' : ''}${nearest?.id === n.id ? 'row-hover ' : ''}${n.kind === 'custom' ? 'row-custom' : ''}`}
                  onMouseEnter={() => onHover(n.distToGo)}
                  onMouseLeave={() => onHover(null)}
                >
                  <th scope="row">
                    <span className="fix-ident">{n.kind === 'airport' ? `${n.ident} ${plan.dest.runway}` : n.ident}</span>
                    <span className="fix-via">{n.kind === 'custom' ? n.name : n.kind === 'airport' ? 'Runway threshold' : n.via}</span>
                    {n.kind === 'custom' && (
                      <button type="button" className="btn-x" aria-label={`Remove ${n.ident}`} onClick={() => onRemoveCustom(n.id)}>
                        ×
                      </button>
                    )}
                  </th>
                  <td className="num">{fmtDist(n.distToGo)}</td>
                  {n.kind === 'airport' ? (
                    <td colSpan={2} className="muted">
                      {fmtAlt(settings.runwayElev + settings.tch, tl)} over the threshold
                    </td>
                  ) : (
                    <>
                      <td>
                        <div className="restr-cell">
                          <select
                            aria-label={`Altitude restriction type at ${n.ident}`}
                            className={r.altType === 'none' ? 'sel sel-empty' : 'sel'}
                            value={r.altType}
                            onChange={(e) => {
                              const altType = e.target.value as AltType;
                              if (altType === 'none') set({ altType, alt1: null, alt2: null });
                              else {
                                set({ altType, alt2: altType === 'between' ? r.alt2 : null });
                                if (r.alt1 == null) setFocusAlt(n.id);
                              }
                            }}
                          >
                            {TYPES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          {r.altType !== 'none' && (
                            <AltField
                              ariaLabel={`${r.altType === 'between' ? 'Lower altitude' : 'Altitude'} at ${n.ident}`}
                              value={r.alt1}
                              transLevel={tl}
                              placeholder="FL or ft"
                              width={84}
                              allowEmpty
                              autoFocus={focusAlt === n.id}
                              onChange={(v) => {
                                setFocusAlt(null);
                                set({ alt1: v });
                              }}
                            />
                          )}
                          {r.altType === 'between' && (
                            <>
                              <span className="muted">and</span>
                              <AltField ariaLabel={`Upper altitude at ${n.ident}`} value={r.alt2} transLevel={tl} placeholder="FL or ft" width={84} allowEmpty onChange={(v) => set({ alt2: v })} />
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <NumField ariaLabel={`Maximum speed at ${n.ident}`} value={r.speed} min={120} max={360} unit="kt" placeholder="none" width={84} allowEmpty onChange={(v) => set({ speed: v })} />
                      </td>
                    </>
                  )}
                  <td className="num sep calc">{fmtAlt(f.alt, tl)}</td>
                  <td className="num calc">{fmtSpeed(f)}</td>
                  <td className="num calc">{inCruise ? '' : fmtVs(f.vs)}</td>
                  <td className="num calc">{inCruise || Math.abs(f.fpa) < 0.05 ? '' : fmtAngle(f.fpa)}</td>
                  <td className="num calc">{fmtDuration(f.t)}</td>
                  <td>
                    <StatusChip status={f.status} note={f.note} />
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>

      <form
        className="add-point"
        onSubmit={(e) => {
          e.preventDefault();
          if (!refId || addDist == null || addDist <= 0) return;
          const id = `custom-${Date.now().toString(36)}`;
          onAddCustom({ id, refId, before: addSide === 'before' ? addDist : -addDist });
          setFocusAlt(id);
        }}
      >
        <span className="add-title">Add a point for a clearance given as a distance from a fix</span>
        <NumField ariaLabel="Distance from the fix" value={addDist} min={0.5} max={300} decimals={1} unit="NM" width={92} onChange={setAddDist} />
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
      </form>
    </section>
  );
}

export const RestrictionTable = memo(RestrictionTableImpl);
