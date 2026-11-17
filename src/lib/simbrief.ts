import { bearingDeg, distanceNm } from './geo';
import type { FlightPlan, RoutePoint, WindLevel } from './types';

/* SimBrief encodes empty values as {} in its JSON output. */
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : fallback;
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function simbriefUrl(pilot: string): string {
  const id = pilot.trim();
  const key = /^\d+$/.test(id) ? 'userid' : 'username';
  return `https://www.simbrief.com/api/xml.fetcher.php?${key}=${encodeURIComponent(id)}&json=1`;
}

export async function fetchFlightPlan(pilot: string): Promise<FlightPlan> {
  if (!pilot.trim()) throw new Error('Enter your SimBrief pilot ID or username.');
  let res: Response;
  try {
    res = await fetch(simbriefUrl(pilot), { cache: 'no-store' });
  } catch {
    throw new Error('SimBrief could not be reached. Check your connection and load again.');
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error('SimBrief returned something unreadable. Load again in a moment.');
  }
  const status = str(data?.fetch?.status);
  if (!res.ok || (status && status !== 'Success')) {
    throw new Error(
      status && status !== 'Success'
        ? `SimBrief says: ${status}. Check the pilot ID and that a flight plan has been generated.`
        : `SimBrief returned an error (${res.status}).`,
    );
  }
  return parseFlightPlan(data);
}

function parseDescentProfile(s: string): { mach: number; cas: number; limit: number } | null {
  const m = s.match(/(\d{2,3})\D+(\d{3})\D+(\d{3})/);
  if (!m) return null;
  let mach = parseInt(m[1], 10);
  mach = mach >= 100 ? mach / 1000 : mach / 100;
  return { mach, cas: parseInt(m[2], 10), limit: parseInt(m[3], 10) };
}

export function parseFlightPlan(data: any): FlightPlan {
  const fixes = arr<any>(data?.navlog?.fix);
  if (fixes.length < 2) throw new Error('This flight plan has no route waypoints to plan a descent on.');

  const general = data.general ?? {};
  const dest = data.destination ?? {};
  const origin = data.origin ?? {};
  const ac = data.aircraft ?? {};

  // Leg distances from coordinates: the navlog rounds them to whole miles.
  const pos = fixes.map((f) => ({ lat: num(f.pos_lat), lon: num(f.pos_long) }));
  const toGo: number[] = new Array(fixes.length).fill(0);
  for (let i = fixes.length - 2; i >= 0; i--) toGo[i] = toGo[i + 1] + distanceNm(pos[i], pos[i + 1]);

  const points: RoutePoint[] = [];
  const sbProfile: FlightPlan['sbProfile'] = [];
  let sbTod: number | null = null;
  const seen = new Map<string, number>();

  fixes.forEach((f, i) => {
    const ident = str(f.ident, `WPT${i + 1}`);
    const isLast = i === fixes.length - 1;
    sbProfile.push({ distToGo: toGo[i], alt: num(f.altitude_feet), ident });
    if (ident === 'TOD' && str(f.type) === 'ltlg') sbTod = toGo[i];
    if ((ident === 'TOC' || ident === 'TOD') && str(f.type) === 'ltlg') return;

    const winds: WindLevel[] = arr<any>(f.wind_data?.level)
      .map((l) => ({ alt: num(l.altitude), dir: num(l.wind_dir), spd: num(l.wind_spd), oat: numOrNull(l.oat) }))
      .sort((a, b) => a.alt - b.alt);

    const n = seen.get(ident) ?? 0;
    seen.set(ident, n + 1);
    points.push({
      id: n ? `${ident}#${n}` : ident,
      ident,
      name: str(f.name, ident),
      kind: isLast ? 'airport' : 'fix',
      lat: pos[i].lat,
      lon: pos[i].lon,
      via: str(f.via_airway),
      isProcedure: str(f.is_sid_star) === '1',
      stage: str(f.stage),
      distToGo: toGo[i],
      trackIn: i > 0 ? bearingDeg(pos[i - 1], pos[i]) : num(f.track_true),
      planAlt: num(f.altitude_feet),
      planCas: num(f.ind_airspeed),
      mora: numOrNull(f.mora),
      groundHeight: numOrNull(f.ground_height),
      planTime: numOrNull(f.time_total),
      winds,
    });
  });

  // On a destination-elevation basis the last profile point is the runway.
  const elevation = num(dest.elevation);
  if (sbProfile.length) sbProfile[sbProfile.length - 1].alt = elevation;

  const runway = str(dest.plan_rwy);
  const rwys = arr<any>(data?.tlr?.landing?.runway);
  const rwy = rwys.find((r) => str(r.identifier) === runway);
  const profile = parseDescentProfile(str(general.descent_profile));
  // Cruise level at the top of descent (after any step climbs).
  const todEntry = sbProfile.find((p) => p.ident === 'TOD' && p.distToGo === sbTod);
  const cruiseAlt =
    todEntry?.alt || Math.max(...points.map((p) => p.planAlt)) || num(general.initial_altitude, 35000);
  const vref = numOrNull(data?.tlr?.landing?.distance_dry?.speeds_vref);

  return {
    id: str(data?.params?.request_id, String(Date.now())),
    generatedAt: num(data?.params?.time_generated),
    callsign: `${str(general.icao_airline)}${str(general.flight_number)}` || 'Flight',
    origin: { icao: str(origin.icao_code), name: str(origin.name) },
    dest: {
      icao: str(dest.icao_code),
      name: str(dest.name),
      elevation: rwy ? num(rwy.elevation, elevation) : elevation,
      runway,
      runwayCourse: rwy ? numOrNull(rwy.true_course) : null,
      transLevel: num(dest.trans_level, 18000),
      metar: str(dest.metar),
      lat: num(dest.pos_lat),
      lon: num(dest.pos_long),
    },
    aircraft: { icao: str(ac.icao_code || ac.icaocode), name: str(ac.name), reg: str(ac.reg) },
    route: str(general.route),
    star: str(general.star_ident),
    cruiseAlt,
    cruiseMach: num(general.cruise_mach, 0.78),
    costIndex: str(general.costindex),
    desMach: profile?.mach ?? num(general.cruise_mach, 0.78),
    desCas: profile?.cas ?? 290,
    limitSpeed: profile?.limit ?? 250,
    landingWeight: num(data?.weights?.est_ldw, 0) * (str(data?.params?.units) === 'lbs' ? 0.45359237 : 1),
    vref,
    isaDev: num(general.avg_temp_dev, 0),
    estOff: numOrNull(data?.times?.est_off),
    points,
    sbProfile,
    sbTodDistToGo: sbTod,
  };
}
