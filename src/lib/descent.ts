// Descent path solver.
//
// The path is built backwards from the runway threshold, the way an FMS does:
// up the final glidepath, then idle-thrust segments at the scheduled speed.
// At each altitude restriction the idle path is clamped into the allowed
// window; when it has to be clamped, the segment below that fix becomes a
// straight (geometric) path and the solver reports whether it needs
// speedbrake or thrust. Where the speed schedule steps down, a shallow
// deceleration segment is inserted. The point where the path meets the
// cruise level is the top of descent.

import { aircraftById, findAircraft, type Aircraft } from './aircraft';
import {
  FT,
  FT_PER_NM,
  G0,
  KT,
  NM,
  airState,
  crossoverAltFt,
  isaTempK,
  machToCas,
  pressurePa,
  tasToCas,
} from './atmosphere';
import { lerpLatLon } from './geo';
import type {
  CustomPoint,
  DescentResult,
  FixPrediction,
  FlightPlan,
  Marker,
  Mode,
  Node,
  Restriction,
  RoutePoint,
  Sample,
  Settings,
  Warning,
  WindLevel,
} from './types';

const STEP = 0.1; // NM
const CRUISE_STEP = 2; // NM
const rad = (d: number) => (d * Math.PI) / 180;

export const NO_RESTRICTION: Restriction = { altType: 'none', alt1: null, alt2: null, speed: null };

export function hasRestriction(r: Restriction | undefined): boolean {
  return !!r && ((r.altType !== 'none' && r.alt1 != null) || r.speed != null);
}

export function defaultSettings(plan: FlightPlan): Settings {
  const ac = findAircraft(plan.aircraft.icao);
  const elev = plan.dest.elevation;
  const last = plan.points[plan.points.length - 1];
  const todPoint =
    plan.points.find((p) => plan.sbTodDistToGo != null && p.distToGo <= plan.sbTodDistToGo) ?? last;
  const manualAlts = [plan.cruiseAlt, 25000, 15000, 5000, Math.max(0, Math.round(elev / 100) * 100)];
  const manualWinds = manualAlts.map((alt) => {
    const w = windFromLevels(alt >= 10000 ? todPoint.winds : last.winds, alt);
    const spd = Math.round(Math.hypot(w.u, w.v));
    const dir = spd ? Math.round(((Math.atan2(-w.u, -w.v) * 180) / Math.PI + 360) % 360) : 0;
    return { alt, dir, spd };
  });
  return {
    aircraftId: ac.id,
    weightKg: plan.landingWeight > 1000 ? Math.round(plan.landingWeight) : ac.refWeight,
    cruiseAlt: plan.cruiseAlt,
    desMach: plan.desMach || ac.desMach,
    desCas: plan.desCas || ac.desCas,
    limitSpeed: plan.limitSpeed || 250,
    limitAlt: 10000,
    runwayElev: Math.round(elev),
    tch: 50,
    gpAngle: 3,
    finalAlt: Math.round((elev + 3000) / 500) * 500,
    finalSpeed: 180,
    vapp: plan.vref ? plan.vref + 5 : ac.vapp,
    decelVs: 500,
    extraMiles: 0,
    windMode: 'plan',
    manualWinds,
    isaDev: plan.isaDev,
    antiIce: false,
    dragFactor: 1,
    transLevel: plan.dest.transLevel,
  };
}

/* ---------- route nodes ---------- */

export function buildNodes(
  plan: FlightPlan,
  settings: Settings,
  restrictions: Record<string, Restriction>,
  customs: CustomPoint[],
): Node[] {
  const extra = Math.max(0, settings.extraMiles || 0);
  const base: Node[] = plan.points.map((p) => ({
    ...p,
    distToGo: p.kind === 'airport' ? 0 : p.distToGo + extra,
    restriction: restrictions[p.id] ?? NO_RESTRICTION,
  }));
  const total = base[0].distToGo;
  const out = [...base];
  for (const c of customs) {
    const ref = base.find((p) => p.id === c.refId);
    if (!ref) continue;
    const d = ref.distToGo + c.before;
    if (d <= 0.2 || d >= total) continue;
    // bracketing fixes: `far` is flown first
    let far = base[0];
    let near = base[base.length - 1];
    for (let i = 0; i < base.length - 1; i++) {
      if (base[i].distToGo >= d && base[i + 1].distToGo <= d) {
        far = base[i];
        near = base[i + 1];
        break;
      }
    }
    const span = far.distToGo - near.distToGo || 1;
    const f = (far.distToGo - d) / span;
    const pos = lerpLatLon(far, near, f);
    const offset = Math.round(Math.abs(c.before) * 10) / 10;
    out.push({
      ...near,
      id: c.id,
      ident: `${ref.ident}/${c.before >= 0 ? '-' : '+'}${offset}`,
      name: `${offset} NM ${c.before >= 0 ? 'before' : 'after'} ${ref.ident}`,
      kind: 'custom',
      lat: pos.lat,
      lon: pos.lon,
      distToGo: d,
      planAlt: far.planAlt + (near.planAlt - far.planAlt) * f,
      planTime:
        far.planTime != null && near.planTime != null
          ? far.planTime + (near.planTime - far.planTime) * f
          : null,
      restriction: restrictions[c.id] ?? NO_RESTRICTION,
    });
  }
  return out.sort((a, b) => b.distToGo - a.distToGo);
}

/** Position along the route at a given distance to go. */
export function positionAt(nodes: RoutePoint[], d: number): { lat: number; lon: number; track: number } {
  for (let i = 0; i < nodes.length - 1; i++) {
    const far = nodes[i];
    const near = nodes[i + 1];
    if (far.distToGo >= d && near.distToGo <= d) {
      const span = far.distToGo - near.distToGo;
      const f = span > 0 ? (far.distToGo - d) / span : 0;
      return { ...lerpLatLon(far, near, f), track: near.trackIn };
    }
  }
  const end = d > nodes[0].distToGo ? nodes[0] : nodes[nodes.length - 1];
  return { lat: end.lat, lon: end.lon, track: end.trackIn };
}

/* ---------- wind field ---------- */

function windFromLevels(levels: WindLevel[], alt: number): { u: number; v: number; oat: number | null } {
  if (!levels.length) return { u: 0, v: 0, oat: null };
  const comp = (l: WindLevel) => ({
    u: -l.spd * Math.sin(rad(l.dir)),
    v: -l.spd * Math.cos(rad(l.dir)),
    oat: l.oat,
  });
  if (alt <= levels[0].alt) return comp(levels[0]);
  const top = levels[levels.length - 1];
  if (alt >= top.alt) return comp(top);
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i];
    const b = levels[i + 1];
    if (alt >= a.alt && alt <= b.alt) {
      const f = (alt - a.alt) / (b.alt - a.alt || 1);
      const ca = comp(a);
      const cb = comp(b);
      return {
        u: ca.u + (cb.u - ca.u) * f,
        v: ca.v + (cb.v - ca.v) * f,
        oat: ca.oat != null && cb.oat != null ? ca.oat + (cb.oat - ca.oat) * f : (ca.oat ?? cb.oat),
      };
    }
  }
  return comp(top);
}

export interface WindSample {
  dir: number;
  spd: number;
  tail: number; // kt
  isaDev: number;
}

export type WindField = (d: number, alt: number) => WindSample;

export function makeWindField(points: RoutePoint[], settings: Settings): WindField {
  // points in flight order (far to near)
  const manual: WindLevel[] = [...settings.manualWinds]
    .map((w) => ({ ...w, oat: null }))
    .sort((a, b) => a.alt - b.alt);
  let cursor = 0;
  return (d, alt) => {
    // locate the leg containing d; queries are nearly monotonic so keep a cursor
    if (cursor > points.length - 2) cursor = points.length - 2;
    while (cursor > 0 && points[cursor].distToGo < d) cursor--;
    while (cursor < points.length - 2 && points[cursor + 1].distToGo > d) cursor++;
    const far = points[cursor];
    const near = points[cursor + 1] ?? far;
    const track = near.trackIn;
    let u = 0;
    let v = 0;
    let isaDev = settings.isaDev;
    if (settings.windMode === 'plan') {
      const span = far.distToGo - near.distToGo;
      const f = span > 0 ? Math.min(1, Math.max(0, (far.distToGo - d) / span)) : 1;
      const a = windFromLevels(far.winds.length ? far.winds : near.winds, alt);
      const b = windFromLevels(near.winds.length ? near.winds : far.winds, alt);
      u = a.u + (b.u - a.u) * f;
      v = a.v + (b.v - a.v) * f;
      const oat = a.oat != null && b.oat != null ? a.oat + (b.oat - a.oat) * f : (a.oat ?? b.oat);
      if (oat != null) isaDev = oat - (isaTempK(alt) - 273.15);
    } else if (settings.windMode === 'manual') {
      const w = windFromLevels(manual, alt);
      u = w.u;
      v = w.v;
    }
    const spd = Math.hypot(u, v);
    const dir = spd > 0.01 ? ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360 : 0;
    const tail = u * Math.sin(rad(track)) + v * Math.cos(rad(track));
    return { dir, spd, tail, isaDev };
  };
}

/* ---------- solver ---------- */

interface State {
  d: number;
  h: number;
  cas: number;
  t: number;
}

interface Ctx {
  ac: Aircraft;
  s: Settings;
  weightN: number;
  wind: WindField;
  speedLimits: { d: number; spd: number }[];
  cruise: number;
}

function targetCas(ctx: Ctx, d: number, h: number): { v: number; onMach: boolean } {
  const { s } = ctx;
  let v = h <= s.limitAlt + 1 ? Math.min(s.limitSpeed, s.desCas) : s.desCas;
  const machCas = machToCas(s.desMach, pressurePa(h));
  let onMach = false;
  if (machCas < v) {
    v = machCas;
    onMach = true;
  }
  for (const r of ctx.speedLimits) {
    if (d <= r.d + 1e-6 && r.spd < v) {
      v = r.spd;
      onMach = false;
    }
  }
  return { v: Math.max(v, s.vapp), onMach };
}

interface Forces {
  air: ReturnType<typeof airState>;
  drag: number;
  thrust: number;
  sbMax: number; // drag of full speedbrake, N
  esf: number; // 1 + (V/g) dV/dh at the scheduled speed law
  tail: number; // m/s
  windDir: number;
  windSpd: number;
}

function forces(ctx: Ctx, d: number, h: number, cas: number, onMach: boolean): Forces {
  const { ac, s } = ctx;
  const w = ctx.wind(d, h);
  const air = airState(h, cas, w.isaDev);
  const q = 0.5 * air.rho * air.tas * air.tas;
  const cl = ctx.weightN / (q * ac.wingArea);
  const flap = Math.min(1, Math.max(0, (ac.cleanSpeed - cas) / 30));
  const cd = (ac.cd0 + ac.cdFlap * flap + ac.k * cl * cl) * s.dragFactor;
  const drag = q * ac.wingArea * cd;
  const thrust =
    ac.thrustSL *
    ac.idleFrac *
    (s.antiIce ? 1.35 : 1) *
    Math.pow(air.sigma, 0.75) *
    Math.max(0.1, 1 - 0.9 * air.mach);
  const tasAt = (alt: number) => {
    const dev = w.isaDev;
    if (onMach) {
      const tK = isaTempK(alt) + dev;
      return air.mach * Math.sqrt(1.4 * 287.05287 * tK);
    }
    return airState(alt, cas, dev).tas;
  };
  const dVdh = (tasAt(h + 100) - tasAt(h - 100)) / (200 * FT);
  return {
    air,
    drag,
    thrust,
    sbMax: q * ac.wingArea * ac.cdSpeedbrake,
    esf: 1 + (air.tas / G0) * dVdh,
    tail: w.tail * KT,
    windDir: w.dir,
    windSpd: w.spd,
  };
}

function record(
  out: Sample[],
  st: State,
  f: Forces,
  cas: number,
  vsMs: number,
  gsMs: number,
  mode: Mode,
  extra: { sb?: number; thrust?: boolean; decel?: boolean; onMach?: boolean } = {},
) {
  out.push({
    d: st.d,
    alt: st.h,
    cas,
    mach: f.air.mach,
    tas: f.air.tas / KT,
    gs: gsMs / KT,
    vs: (vsMs / FT) * 60,
    fpa: (Math.atan2(vsMs, gsMs) * 180) / Math.PI,
    t: st.t,
    mode,
    sb: extra.sb ?? 0,
    thrust: extra.thrust ?? false,
    decel: extra.decel ?? false,
    tail: f.tail / KT,
    windDir: f.windDir,
    windSpd: f.windSpd,
    onMach: extra.onMach ?? false,
  });
}

const minGs = 60 * KT;

/** Idle-thrust path from `from` back to distance `dEnd`. */
function integrateIdle(ctx: Ctx, from: State, dEnd: number, out: Sample[]): State {
  const st = { ...from };
  while (st.d < dEnd - 1e-9) {
    const atCruise = st.h >= ctx.cruise - 0.5;
    let ds = Math.min(atCruise ? CRUISE_STEP : STEP, dEnd - st.d);
    const tgt = targetCas(ctx, st.d + ds, st.h);

    if (atCruise) {
      const cas = Math.min(st.cas, tgt.v) < tgt.v - 0.5 ? st.cas : tgt.v;
      const f = forces(ctx, st.d, st.h, cas, tgt.onMach);
      const gs = Math.max(minGs, f.air.tas + f.tail);
      record(out, st, f, cas, 0, gs, 'cruise', { onMach: tgt.onMach });
      st.t += (ds * NM) / gs;
      st.d += ds;
      st.cas = tgt.v;
      st.h = ctx.cruise;
      continue;
    }

    if (st.cas < tgt.v - 0.5) {
      // Deceleration segment: shallow path, idle thrust, speed bleeding off.
      const f = forces(ctx, st.d, st.h, st.cas, false);
      const idleSin = -(f.drag - f.thrust) / ctx.weightN / f.esf;
      const vsTarget = -Math.min((ctx.s.decelVs * FT) / 60, 0.6 * Math.abs(f.air.tas * idleSin));
      let sinG = vsTarget / f.air.tas;
      let a = G0 * ((f.thrust - f.drag) / ctx.weightN - sinG);
      if (a > -0.1) {
        sinG = 0;
        a = Math.min(-0.02, (G0 * (f.thrust - f.drag)) / ctx.weightN);
      }
      const gs = Math.max(minGs, f.air.tas * Math.sqrt(1 - sinG * sinG) + f.tail);
      let dt = (ds * NM) / gs;
      let dh = (-f.air.tas * sinG * dt) / FT;
      if (st.h + dh > ctx.cruise) {
        const frac = Math.max(0.01, (ctx.cruise - st.h) / dh);
        ds *= frac;
        dt *= frac;
        dh = ctx.cruise - st.h;
      }
      record(out, st, f, st.cas, f.air.tas * sinG, gs, 'decel', { decel: true });
      const hNew = st.h + dh;
      const tasNew = f.air.tas - a * dt;
      const next = targetCas(ctx, st.d + ds, hNew);
      st.cas = Math.min(tasToCas(tasNew, hNew, ctx.wind(st.d, hNew).isaDev), next.v);
      st.h = hNew;
      st.d += ds;
      st.t += dt;
      continue;
    }

    const cas = Math.min(st.cas, tgt.v);
    const f = forces(ctx, st.d, st.h, cas, tgt.onMach);
    const sinG = Math.min(-0.003, -(f.drag - f.thrust) / ctx.weightN / f.esf);
    const gs = Math.max(minGs, f.air.tas * Math.sqrt(1 - sinG * sinG) + f.tail);
    let dt = (ds * NM) / gs;
    let dh = (-f.air.tas * sinG * dt) / FT;
    if (st.h + dh > ctx.cruise) {
      const frac = Math.max(0.01, (ctx.cruise - st.h) / dh);
      ds *= frac;
      dt *= frac;
      dh = ctx.cruise - st.h;
    }
    record(out, st, f, cas, f.air.tas * sinG, gs, 'idle', { onMach: tgt.onMach });
    const hNew = st.h + dh;
    const next = targetCas(ctx, st.d + ds, hNew);
    st.cas = next.v < cas ? next.v : next.v > cas + 0.5 ? cas : next.v;
    st.h = hNew;
    st.d += ds;
    st.t += dt;
  }
  return st;
}

/** Straight path of `grad` ft per NM from `from` back to `dEnd`. */
function integrateGeo(ctx: Ctx, from: State, dEnd: number, grad: number, out: Sample[]): State {
  const st = { ...from };
  const level = grad < 1;
  while (st.d < dEnd - 1e-9) {
    const atCruise = level && st.h >= ctx.cruise - 0.5;
    const ds = Math.min(atCruise ? CRUISE_STEP : STEP, dEnd - st.d);
    const tgt = targetCas(ctx, st.d + ds, st.h);
    const decel = st.cas < tgt.v - 0.5;
    const cas = decel ? st.cas : Math.min(st.cas, tgt.v);
    const f = forces(ctx, st.d, st.h, cas, !decel && tgt.onMach);
    const gs = Math.max(minGs, f.air.tas + f.tail);
    const dt = (ds * NM) / gs;
    const vs = ((-grad * FT) / NM) * gs;
    const sinG = vs / f.air.tas;
    const hNew = st.h + grad * ds;
    const mode: Mode = atCruise ? 'cruise' : level ? 'level' : 'geo';
    const net = (f.thrust - f.drag) / ctx.weightN;

    if (decel) {
      let a = G0 * (net - sinG);
      let sb = 0;
      if (a > -0.2) {
        // idle alone will not slow the aircraft on this path
        const need = ctx.weightN * (net - sinG + 0.25 / G0);
        sb = need / f.sbMax;
        if (sb <= 1) {
          a = -0.25;
        } else {
          a -= (G0 * f.sbMax) / ctx.weightN;
          if (a > -0.03) a = 0;
          else sb = 1;
        }
      }
      record(out, st, f, cas, vs, gs, mode, { sb, decel: true });
      const next = targetCas(ctx, st.d + ds, hNew);
      st.cas = Math.min(tasToCas(f.air.tas - a * dt, hNew, ctx.wind(st.d, hNew).isaDev), next.v);
    } else {
      const extra = (-sinG * f.esf + net) * ctx.weightN; // drag still needed (N)
      const sb = extra > 0 ? extra / f.sbMax : 0;
      record(out, st, f, cas, vs, gs, mode, {
        sb,
        thrust: extra < -0.004 * ctx.weightN,
        onMach: tgt.onMach,
      });
      const next = targetCas(ctx, st.d + ds, hNew);
      st.cas = next.v < cas ? next.v : next.v > cas + 0.5 ? cas : next.v;
    }
    st.h = hNew;
    st.d += ds;
    st.t += dt;
  }
  st.h = from.h + grad * (dEnd - from.d);
  return st;
}

function window(r: Restriction, cruise: number): [number, number] | null {
  if (r.altType === 'none' || r.alt1 == null) return null;
  let lo = -Infinity;
  let hi = Infinity;
  if (r.altType === 'at') lo = hi = r.alt1;
  else if (r.altType === 'above') lo = r.alt1;
  else if (r.altType === 'below') hi = r.alt1;
  else {
    const other = r.alt2 ?? r.alt1;
    lo = Math.min(r.alt1, other);
    hi = Math.max(r.alt1, other);
  }
  return [Math.min(lo, cruise), Math.min(hi, cruise)];
}

export function sampleAt(samples: Sample[], d: number): Sample | null {
  // samples are in flight order: d descending
  if (!samples.length) return null;
  if (d >= samples[0].d) return samples[0];
  const last = samples[samples.length - 1];
  if (d <= last.d) return last;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].d >= d) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = (a.d - d) / (a.d - b.d || 1);
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    ...b,
    d,
    alt: mix(a.alt, b.alt),
    cas: mix(a.cas, b.cas),
    mach: mix(a.mach, b.mach),
    tas: mix(a.tas, b.tas),
    gs: mix(a.gs, b.gs),
    t: mix(a.t, b.t),
    tail: mix(a.tail, b.tail),
    windSpd: mix(a.windSpd, b.windSpd),
  };
}

export function computeDescent(
  plan: FlightPlan,
  settings: Settings,
  restrictions: Record<string, Restriction>,
  customs: CustomPoint[],
): DescentResult {
  const nodes = buildNodes(plan, settings, restrictions, customs);
  const basePoints = nodes.filter((n) => n.kind !== 'custom');
  const ac = aircraftById(settings.aircraftId);
  const totalDist = nodes[0].distToGo;
  const threshold = settings.runwayElev + settings.tch;
  const cruise = Math.max(settings.cruiseAlt, threshold + 1000);
  const ctx: Ctx = {
    ac,
    s: settings,
    weightN: Math.max(10000, settings.weightKg) * G0,
    wind: makeWindField(basePoints, settings),
    speedLimits: nodes
      .filter((n) => n.restriction.speed != null && n.distToGo > 0)
      .map((n) => ({ d: n.distToGo, spd: n.restriction.speed as number })),
    cruise,
  };

  const back: Sample[] = [];
  const warnings: Warning[] = [];
  const conflicts = new Map<string, string>();

  /* final approach, threshold up to the glidepath intercept altitude */
  let st: State = { d: 0, h: threshold, cas: settings.vapp, t: 0 };
  const gpGrad = FT_PER_NM * Math.tan(rad(Math.min(6, Math.max(2, settings.gpAngle))));
  const finalAlt = Math.min(Math.max(settings.finalAlt, threshold), cruise);
  const finalSpeed = Math.max(settings.finalSpeed, settings.vapp);
  while (st.h < finalAlt - 0.01) {
    const ds = Math.min(STEP, (finalAlt - st.h) / gpGrad);
    const f = forces(ctx, st.d, st.h, st.cas, false);
    const gs = Math.max(minGs, f.air.tas + f.tail);
    const dt = (ds * NM) / gs;
    record(back, st, f, st.cas, ((-gpGrad * FT) / NM) * gs, gs, 'final', {
      decel: st.cas > settings.vapp + 0.5,
    });
    const hNew = st.h + gpGrad * ds;
    const cas =
      hNew <= settings.runwayElev + 1000 ? settings.vapp : Math.min(finalSpeed, st.cas + 0.6 * dt);
    st = { d: st.d + ds, h: hNew, cas, t: st.t + dt };
  }
  const fapDist = st.d;

  /* restrictions above the final approach, nearest first */
  const binding = nodes
    .filter((n) => n.distToGo > fapDist + 0.05 && window(n.restriction, cruise))
    .sort((a, b) => a.distToGo - b.distToGo);

  for (const node of binding) {
    const [lo, hi] = window(node.restriction, cruise)!;
    const trial: Sample[] = [];
    const end = integrateIdle(ctx, st, node.distToGo, trial);
    if (end.h >= lo - 5 && end.h <= hi + 5) {
      back.push(...trial);
      st = end;
      continue;
    }
    let target = Math.min(hi, Math.max(lo, end.h));
    if (target < st.h - 5) {
      // would need a climb between this fix and the next one down the route
      const below = nodes.filter((n) => n.distToGo <= st.d + 0.05).sort((a, b) => b.distToGo - a.distToGo)[0];
      conflicts.set(
        node.id,
        `Cannot be met: the path is already at ${Math.round(st.h)} ft at ${below?.ident ?? 'the next fix'}, which is higher.`,
      );
      target = st.h;
    }
    const grad = (target - st.h) / (node.distToGo - st.d);
    st = integrateGeo(ctx, st, node.distToGo, grad, back);
  }
  st = integrateIdle(ctx, st, totalDist, back);
  {
    // closing sample at the start of the route
    const tgt = targetCas(ctx, st.d, st.h);
    const f = forces(ctx, st.d, st.h, st.cas, tgt.onMach);
    record(back, st, f, st.cas, 0, Math.max(minGs, f.air.tas + f.tail), st.h >= cruise - 0.5 ? 'cruise' : 'idle', {
      onMach: tgt.onMach,
    });
  }

  const samples = back.reverse();

  /* top of descent */
  let tod: DescentResult['tod'] = null;
  let todIdx = -1;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].alt < cruise - 0.5) {
      todIdx = i - 1;
      break;
    }
  }
  const markers: Marker[] = [];
  if (todIdx >= 0) {
    const d = samples[todIdx].d;
    const pos = positionAt(nodes, d);
    const real = nodes.filter((n) => n.kind !== 'custom');
    const next = [...real].reverse().find((n) => n.distToGo >= 0 && n.distToGo <= d) ?? real[real.length - 1];
    const candidates = real.filter((n) => n.distToGo <= d);
    const ref = candidates.length ? candidates[0] : next;
    tod = { d, lat: pos.lat, lon: pos.lon, refIdent: ref.ident, refOffset: d - ref.distToGo };
    markers.push({
      kind: 'tod',
      d,
      alt: cruise,
      label: 'T/D',
      detail: `Top of descent, ${d.toFixed(1)} NM to run`,
    });
  } else {
    warnings.push({
      level: 'warning',
      text: `The descent path never reaches the cruise level of ${Math.round(cruise)} ft on this route. Start down at once, or check the cruise level in the setup.`,
    });
  }

  /* deceleration points */
  for (let i = 1; i < samples.length; i++) {
    const s0 = samples[i - 1];
    const s1 = samples[i];
    if (s1.decel && !s0.decel && s1.mode !== 'final') {
      let j = i;
      while (j < samples.length - 1 && samples[j + 1].decel && samples[j + 1].mode !== 'final') j++;
      const to = samples[Math.min(j + 1, samples.length - 1)].cas;
      if (s1.cas - to < 3) continue;
      markers.push({
        kind: 'decel',
        d: s1.d,
        alt: s1.alt,
        label: 'D',
        detail: `Slow from ${Math.round(s1.cas)} to ${Math.round(to)} kt`,
      });
    }
  }
  if (fapDist > 0.2) {
    markers.push({
      kind: 'fap',
      d: fapDist,
      alt: finalAlt,
      label: 'FAP',
      detail: `Glidepath intercept, ${fapDist.toFixed(1)} NM from the threshold`,
    });
  }
  if (plan.sbTodDistToGo != null) {
    markers.push({
      kind: 'sbtod',
      d: plan.sbTodDistToGo + Math.max(0, settings.extraMiles || 0),
      alt: cruise,
      label: 'SimBrief T/D',
      detail: 'Top of descent in the SimBrief plan',
    });
  }

  /* predictions at each fix */
  const fixes: Record<string, FixPrediction> = {};
  for (const n of nodes) {
    const s = sampleAt(samples, n.distToGo)!;
    let status: FixPrediction['status'] = 'none';
    let note = '';
    const r = n.restriction;
    const win = window(r, Infinity);
    if (win) {
      status = 'met';
      const [lo, hi] = win;
      if (s.alt < lo - 50) {
        status = 'missed';
        note = `${Math.round(lo - s.alt)} ft low`;
      } else if (s.alt > hi + 50) {
        status = 'missed';
        note = `${Math.round(s.alt - hi)} ft high`;
      }
      if (conflicts.has(n.id)) {
        status = 'conflict';
        note = conflicts.get(n.id)!;
      } else if (status === 'missed' && n.distToGo <= fapDist + 0.05) {
        note += ' on the final glidepath';
      } else if (status === 'missed' && lo > cruise) {
        note = 'above the cruise level';
        status = 'met';
      }
    }
    if (r.speed != null) {
      if (status === 'none') status = 'met';
      if (s.cas > r.speed + 3) {
        status = status === 'conflict' ? status : 'missed';
        note = `${note ? note + ', ' : ''}${Math.round(s.cas - r.speed)} kt fast`;
      }
    }
    fixes[n.id] = {
      id: n.id,
      d: n.distToGo,
      alt: s.alt,
      cas: s.cas,
      mach: s.mach,
      onMach: s.onMach,
      vs: s.vs,
      fpa: s.fpa,
      t: s.t,
      gs: s.gs,
      status,
      note,
    };
    if (status === 'conflict') warnings.push({ level: 'warning', text: `${n.ident}: ${note}` });
    else if (status === 'missed')
      warnings.push({ level: 'warning', text: `${n.ident}: restriction missed, ${note}.` });
  }

  /* steep segments */
  const real = nodes.filter((n) => n.kind !== 'custom');
  const between = (from: number, to: number) => {
    const a = real.filter((n) => n.distToGo >= from - 0.3).pop();
    const b = real.find((n) => n.distToGo <= to + 0.3);
    if (a && b && a.id !== b.id) return `between ${a.ident} and ${b.ident}`;
    return `around ${(b ?? a)?.ident ?? `${from.toFixed(0)} NM to go`}`;
  };
  let i = 0;
  while (i < samples.length) {
    if (samples[i].sb > 0.15) {
      let j = i;
      let peak = 0;
      let stuck = false;
      while (j < samples.length && samples[j].sb > 0.15) {
        peak = Math.max(peak, samples[j].sb);
        if (samples[j].sb > 1) stuck = true;
        j++;
      }
      const from = samples[i].d;
      const to = samples[j - 1].d;
      if (from - to >= 0.8) {
        const spd = Math.round(samples[i].cas);
        warnings.push(
          stuck
            ? {
                level: 'warning',
                from,
                to,
                text: `Too steep ${between(from, to)}: holding ${spd} kt needs more than full speedbrake. Expect the speed to run away, or ease a restriction.`,
              }
            : {
                level: 'caution',
                from,
                to,
                text: `Speedbrake needed ${between(from, to)}, about ${Math.round((peak * 100) / 5) * 5}% at the steepest point.`,
              },
        );
      }
      i = j;
    } else i++;
  }

  const descentTime = todIdx >= 0 ? samples[todIdx].t : samples[0].t;
  return {
    samples,
    nodes,
    fixes,
    markers,
    warnings,
    tod,
    fapDist,
    descentTime,
    avgGradient: tod ? (cruise - threshold) / tod.d : 0,
    crossover: crossoverAltFt(settings.desCas, settings.desMach),
    totalDist,
  };
}
