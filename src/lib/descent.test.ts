import { describe, expect, it } from 'vitest';
import ofp from '../fixtures/sample-ofp.json';
import { computeDescent, defaultSettings } from './descent';
import { parseFlightPlan } from './simbrief';
import type { Restriction } from './types';
import { crossoverAltFt, machToCas, casToMach, pressurePa } from './atmosphere';

const plan = parseFlightPlan(ofp);
const R = (r: Partial<Restriction>): Restriction => ({ altType: 'none', alt1: null, alt2: null, speed: null, ...r });

describe('atmosphere', () => {
  it('converts CAS and Mach consistently', () => {
    const p = pressurePa(35000);
    expect(casToMach(machToCas(0.78, p), p)).toBeCloseTo(0.78, 5);
    expect(machToCas(0.78, p)).toBeGreaterThan(255);
    expect(machToCas(0.78, p)).toBeLessThan(275);
    expect(crossoverAltFt(300, 0.78)).toBeGreaterThan(28000);
    expect(crossoverAltFt(300, 0.78)).toBeLessThan(31000);
  });
});

describe('flight plan', () => {
  it('parses the SimBrief navlog', () => {
    expect(plan.callsign).toBe('BAW5230');
    expect(plan.dest.icao).toBe('ENBR');
    expect(plan.cruiseAlt).toBe(35000);
    expect(plan.points.at(-1)!.kind).toBe('airport');
    expect(plan.points.find((p) => p.ident === 'TOD')).toBeUndefined();
    expect(plan.sbTodDistToGo).toBeGreaterThan(90);
  });
});

describe('descent solver', () => {
  const s = defaultSettings(plan);

  it('puts the top of descent near the SimBrief plan', () => {
    const r = computeDescent(plan, s, {}, []);

    expect(r.tod).not.toBeNull();
    expect(Math.abs(r.tod!.d - plan.sbTodDistToGo!)).toBeLessThan(12);
    expect(r.warnings).toHaveLength(0);
  });

  it('is monotonic and ends at the threshold', () => {
    const r = computeDescent(plan, s, {}, []);
    for (let i = 1; i < r.samples.length; i++) {
      expect(r.samples[i].alt).toBeLessThanOrEqual(r.samples[i - 1].alt + 0.01);
      expect(r.samples[i].d).toBeLessThan(r.samples[i - 1].d);
    }
    const last = r.samples.at(-1)!;
    expect(last.d).toBe(0);
    expect(last.alt).toBeCloseTo(s.runwayElev + s.tch, 3);
  });

  it('honours an "at" restriction', () => {
    const r = computeDescent(plan, s, { IRLOB: R({ altType: 'at', alt1: 12000 }) }, []);
    expect(r.fixes.IRLOB.alt).toBeCloseTo(12000, 0);
    expect(r.fixes.IRLOB.status).toBe('met');
  });

  it('moves the top of descent earlier for an "at or below" restriction', () => {
    const base = computeDescent(plan, s, {}, []);
    const r = computeDescent(plan, s, { MODNI: R({ altType: 'below', alt1: 15000 }) }, []);
    expect(r.fixes.MODNI.alt).toBeLessThanOrEqual(15001);
    expect(r.tod!.d).toBeGreaterThan(base.tod!.d + 5);
  });

  it('leaves the path alone when a restriction does not bind', () => {
    const base = computeDescent(plan, s, {}, []);
    const r = computeDescent(plan, s, { MODNI: R({ altType: 'above', alt1: 10000 }) }, []);
    expect(r.tod!.d).toBeCloseTo(base.tod!.d, 1);
  });

  it('flags a path that is too steep', () => {
    const r = computeDescent(plan, s, { BR630: R({ altType: 'above', alt1: 20000 }) }, []);
    expect(r.fixes.BR630.alt).toBeCloseTo(20000, 0);
    expect(r.warnings.some((w) => w.level === 'warning')).toBe(true);
  });

  it('slows down for a speed restriction', () => {
    const r = computeDescent(plan, s, { BR634: R({ speed: 220 }) }, []);
    expect(r.fixes.BR634.cas).toBeLessThanOrEqual(221);
    expect(r.fixes.BR636.cas).toBeGreaterThan(225);
  });

  it('reports conflicting restrictions', () => {
    const r = computeDescent(plan, s, { BR630: R({ altType: 'at', alt1: 9000 }), BR634: R({ altType: 'at', alt1: 6000 }) }, []);
    expect(r.fixes.BR634.status).toBe('conflict');
  });

  it('a tailwind pushes the top of descent out', () => {
    const calm = computeDescent(plan, { ...s, windMode: 'calm' }, {}, []);
    const windy = computeDescent(plan, s, {}, []);

    expect(windy.tod!.d).toBeGreaterThan(calm.tod!.d);
  });

  it('supports a custom point', () => {
    const r = computeDescent(plan, s, { c1: R({ altType: 'at', alt1: 20000 }) }, [{ id: 'c1', refId: 'MODNI', before: 10 }]);
    expect(r.fixes.c1.alt).toBeCloseTo(20000, 0);
    expect(r.fixes.c1.d).toBeCloseTo(r.fixes.MODNI.d + 10, 5);
  });

  it('stays finite under awkward settings', () => {
    const variants = [
      { finalAlt: 0 },
      { cruiseAlt: 6000 },
      { gpAngle: 5.5, finalAlt: 9000 },
      { desCas: 180, limitSpeed: 160, vapp: 170, finalSpeed: 150 },
      { weightKg: 5000, dragFactor: 1.6 },
      { extraMiles: 80, decelVs: 0 },
      { windMode: 'manual' as const, manualWinds: [{ alt: 0, dir: 50, spd: 200 }] },
      { antiIce: true, dragFactor: 0.6, weightKg: 78000 },
    ];
    const restr = { MODNI: R({ altType: 'between', alt1: 30000, alt2: 2000, speed: 150 }), IRLOB: R({ altType: 'at', alt1: 39000 }), NEPAM: R({ altType: 'below', alt1: 500 }) };
    for (const v of variants) {
      for (const rs of [{}, restr]) {
        const r = computeDescent(plan, { ...s, ...v }, rs, [{ id: 'x', refId: 'BR630', before: -4 }]);
        expect(r.samples.length).toBeGreaterThan(10);
        for (const p of r.samples) {
          expect(Number.isFinite(p.alt) && Number.isFinite(p.cas) && Number.isFinite(p.vs) && Number.isFinite(p.t)).toBe(true);
        }
        expect(r.samples.at(-1)!.d).toBe(0);
      }
    }
  });
});
