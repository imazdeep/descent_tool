import type { Restriction, Sample } from './types';

export function fmtAlt(ft: number, transLevel: number): string {
  if (ft >= transLevel - 1) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return `${(Math.round(ft / 10) * 10).toLocaleString('en-US')} ft`;
}

/** Compact altitude for tight spots: FL120 or 7000. */
export function fmtAltShort(ft: number, transLevel: number): string {
  if (ft >= transLevel - 1) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return String(Math.round(ft / 10) * 10);
}

/** Accepts FL120, F120, 120 (flight level), 12000, 12,000. */
export function parseAlt(text: string): number | null {
  const t = text.trim().toUpperCase().replace(/[, ]/g, '').replace(/FT$/, '');
  if (!t) return null;
  const fl = t.match(/^F?L?(\d{1,3})$/);
  if (fl && (t.startsWith('F') || parseInt(fl[1], 10) <= 600)) return parseInt(fl[1], 10) * 100;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 60000 ? Math.round(n) : null;
}

export function fmtDist(nm: number): string {
  return nm >= 100 ? nm.toFixed(0) : nm.toFixed(1);
}

export function fmtVs(fpm: number): string {
  const r = Math.round(fpm / 50) * 50;
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('en-US')}`;
}

export function fmtAngle(deg: number): string {
  return `${Math.abs(deg).toFixed(1)}°`;
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtMinutes(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

export function fmtSpeed(s: Pick<Sample, 'cas' | 'mach' | 'onMach'>): string {
  return s.onMach ? `M ${s.mach.toFixed(2).replace(/^0/, '')}` : `${Math.round(s.cas)} kt`;
}

export function fmtUtc(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

export function fmtAgo(epochSec: number): string {
  const s = Date.now() / 1000 - epochSec;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function describeRestriction(r: Restriction, transLevel: number): string {
  const parts: string[] = [];
  if (r.altType !== 'none' && r.alt1 != null) {
    const a = fmtAlt(r.alt1, transLevel);
    if (r.altType === 'at') parts.push(`at ${a}`);
    else if (r.altType === 'above') parts.push(`at or above ${a}`);
    else if (r.altType === 'below') parts.push(`at or below ${a}`);
    else parts.push(`between ${a} and ${fmtAlt(r.alt2 ?? r.alt1, transLevel)}`);
  }
  if (r.speed != null) parts.push(`max ${r.speed} kt`);
  return parts.join(', ');
}

export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** How a stretch of the path flies: at idle, with speedbrake, or not at all. */
export type PathKind = 'normal' | 'brake' | 'steep';

export function pathKind(s: Sample): PathKind {
  if (s.sb > 1) return 'steep';
  if (s.sb > 0.15) return 'brake';
  return 'normal';
}

export function describeSample(s: Sample): string {
  if (s.sb > 1) return 'Too steep to hold this speed';
  if (s.sb > 0.15) return `Speedbrake about ${Math.min(100, Math.round((s.sb * 100) / 5) * 5)}%`;
  if (s.mode === 'cruise') return 'Cruise';
  if (s.mode === 'final') return 'Final approach';
  if (s.decel || s.mode === 'decel') return 'Slowing down';
  if (s.mode === 'level') return 'Level';
  return s.thrust ? 'Some thrust' : 'Idle';
}
