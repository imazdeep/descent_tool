// International Standard Atmosphere and airspeed conversions.
// Altitudes are pressure altitudes in feet; speeds in knots unless noted.

export const KT = 0.514444; // m/s per knot
export const FT = 0.3048; // m per foot
export const NM = 1852; // m per nautical mile
export const G0 = 9.80665;
export const FT_PER_NM = NM / FT;

const T0 = 288.15;
const P0 = 101325;
const RHO0 = 1.225;
const LAPSE = 0.0065;
const R = 287.05287;
const GAMMA = 1.4;
const H_TROP = 11000;
const T_TROP = 216.65;
const P_TROP = P0 * Math.pow(T_TROP / T0, G0 / (LAPSE * R));
const A0 = Math.sqrt(GAMMA * R * T0);

/** ISA temperature in kelvin at a pressure altitude. */
export function isaTempK(altFt: number): number {
  const h = altFt * FT;
  return h < H_TROP ? T0 - LAPSE * h : T_TROP;
}

/** Static pressure in pascals at a pressure altitude. */
export function pressurePa(altFt: number): number {
  const h = altFt * FT;
  if (h < H_TROP) return P0 * Math.pow(1 - (LAPSE * h) / T0, G0 / (LAPSE * R));
  return P_TROP * Math.exp((-G0 * (h - H_TROP)) / (R * T_TROP));
}

export function casToMach(casKt: number, p: number): number {
  const v = (casKt * KT) / A0;
  const qc = P0 * (Math.pow(1 + 0.2 * v * v, 3.5) - 1);
  return Math.sqrt(5 * (Math.pow(qc / p + 1, 2 / 7) - 1));
}

export function machToCas(mach: number, p: number): number {
  const qc = p * (Math.pow(1 + 0.2 * mach * mach, 3.5) - 1);
  return (A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1))) / KT;
}

export interface AirState {
  p: number;
  tempK: number;
  rho: number;
  sigma: number;
  a: number; // speed of sound, m/s
  mach: number;
  tas: number; // m/s
}

export function airState(altFt: number, casKt: number, isaDev: number): AirState {
  const p = pressurePa(altFt);
  const tempK = isaTempK(altFt) + isaDev;
  const rho = p / (R * tempK);
  const a = Math.sqrt(GAMMA * R * tempK);
  const mach = casToMach(casKt, p);
  return { p, tempK, rho, sigma: rho / RHO0, a, mach, tas: mach * a };
}

/** CAS in knots for a true airspeed (m/s) at altitude. */
export function tasToCas(tasMs: number, altFt: number, isaDev: number): number {
  const p = pressurePa(altFt);
  const a = Math.sqrt(GAMMA * R * (isaTempK(altFt) + isaDev));
  return machToCas(tasMs / a, p);
}

/** Altitude where a CAS and a Mach number give the same true airspeed. */
export function crossoverAltFt(casKt: number, mach: number): number {
  let lo = 0;
  let hi = 45000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (casToMach(casKt, pressurePa(mid)) < mach) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
