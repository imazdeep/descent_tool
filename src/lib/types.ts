export interface WindLevel {
  alt: number; // ft
  dir: number; // degrees true, direction the wind blows from
  spd: number; // kt
  oat: number | null; // °C
}

export interface RoutePoint {
  id: string;
  ident: string;
  name: string;
  kind: 'fix' | 'airport' | 'custom';
  lat: number;
  lon: number;
  via: string;
  isProcedure: boolean;
  stage: string;
  /** Along-track distance from this point to the destination, NM. */
  distToGo: number;
  /** True track of the leg flown into this point. */
  trackIn: number;
  planAlt: number;
  planCas: number;
  mora: number | null;
  groundHeight: number | null;
  /** Seconds after takeoff in the SimBrief plan. */
  planTime: number | null;
  winds: WindLevel[];
}

export interface FlightPlan {
  id: string;
  generatedAt: number; // epoch seconds
  callsign: string;
  origin: { icao: string; name: string };
  dest: {
    icao: string;
    name: string;
    elevation: number;
    runway: string;
    runwayCourse: number | null;
    transLevel: number;
    metar: string;
    lat: number;
    lon: number;
  };
  aircraft: { icao: string; name: string; reg: string };
  route: string;
  star: string;
  cruiseAlt: number;
  cruiseMach: number;
  costIndex: string;
  desMach: number;
  desCas: number;
  limitSpeed: number;
  landingWeight: number; // kg
  vref: number | null;
  isaDev: number;
  estOff: number | null; // epoch seconds
  points: RoutePoint[]; // in flight order, destination last
  /** SimBrief's own planned vertical profile, for comparison. */
  sbProfile: { distToGo: number; alt: number; ident: string }[];
  sbTodDistToGo: number | null;
}

export type AltType = 'none' | 'at' | 'above' | 'below' | 'between';

export interface Restriction {
  altType: AltType;
  alt1: number | null; // ft. For "between" this is the lower limit.
  alt2: number | null; // ft. Upper limit for "between".
  speed: number | null; // kt, at or below, applies from this point onward
}

export interface CustomPoint {
  id: string;
  refId: string;
  /** NM before the reference fix along the route (negative = after). */
  before: number;
}

export type WindMode = 'plan' | 'manual' | 'calm';

export interface Settings {
  aircraftId: string;
  weightKg: number;
  cruiseAlt: number;
  desMach: number;
  desCas: number;
  limitSpeed: number;
  limitAlt: number;
  runwayElev: number;
  tch: number;
  gpAngle: number;
  finalAlt: number;
  finalSpeed: number;
  vapp: number;
  decelVs: number;
  extraMiles: number;
  windMode: WindMode;
  manualWinds: { alt: number; dir: number; spd: number }[];
  isaDev: number;
  antiIce: boolean;
  dragFactor: number;
  transLevel: number;
}

export type Mode = 'cruise' | 'idle' | 'geo' | 'level' | 'decel' | 'final';

export interface Sample {
  d: number; // NM to go
  alt: number; // ft
  cas: number; // kt
  mach: number;
  tas: number; // kt
  gs: number; // kt
  vs: number; // ft/min, negative in descent
  fpa: number; // degrees over the ground, negative in descent
  t: number; // seconds to touchdown
  mode: Mode;
  /** Speedbrake demand: 0 none, 1 full, above 1 not flyable at this speed. */
  sb: number;
  /** True when thrust above idle is needed to hold the path. */
  thrust: boolean;
  /** True while the speed is being reduced. */
  decel: boolean;
  tail: number; // kt, positive tailwind
  windDir: number;
  windSpd: number;
  onMach: boolean;
}

export interface FixPrediction {
  id: string;
  d: number;
  alt: number;
  cas: number;
  mach: number;
  onMach: boolean;
  vs: number;
  fpa: number;
  t: number;
  gs: number;
  status: 'none' | 'met' | 'missed' | 'conflict';
  note: string;
}

export interface Marker {
  kind: 'tod' | 'decel' | 'fap' | 'sbtod';
  d: number;
  alt: number;
  label: string;
  detail: string;
}

export interface Warning {
  level: 'caution' | 'warning';
  text: string;
  from?: number;
  to?: number;
}

export interface Node extends RoutePoint {
  restriction: Restriction;
}

export interface DescentResult {
  samples: Sample[]; // flight order: far to near
  nodes: Node[]; // all points incl. custom, flight order
  fixes: Record<string, FixPrediction>;
  markers: Marker[];
  warnings: Warning[];
  tod: { d: number; lat: number; lon: number; refIdent: string; refOffset: number } | null;
  fapDist: number;
  descentTime: number; // s from TOD to touchdown
  avgGradient: number; // ft per NM from TOD to threshold
  crossover: number; // ft
  totalDist: number;
}
