// Approximate point-mass performance data. Drag is a parabolic polar,
// idle thrust a simple density and Mach lapse of the sea-level rating.
// These are simulator-grade estimates, tuned against published descent
// figures; the drag factor in the setup panel trims them per airframe.

export interface Aircraft {
  id: string;
  name: string;
  match: string[]; // ICAO type designators
  wingArea: number; // m²
  cd0: number;
  k: number; // induced drag factor
  cdFlap: number; // extra CD0 once slats/flaps start coming out
  cdSpeedbrake: number; // extra CD0 at full speedbrake
  thrustSL: number; // total sea-level static thrust, N
  idleFrac: number; // idle thrust as a fraction of thrustSL at sea level, static
  cleanSpeed: number; // kt, below this the approach-config drag applies
  desMach: number;
  desCas: number;
  vapp: number;
  refWeight: number; // typical landing weight, kg
}

const narrow = { cdFlap: 0.014, cdSpeedbrake: 0.02, idleFrac: 0.045 };
const wide = { cdFlap: 0.012, cdSpeedbrake: 0.016, idleFrac: 0.042 };

export const AIRCRAFT: Aircraft[] = [
  { id: 'A319', name: 'Airbus A319', match: ['A319', 'A19N'], wingArea: 122.6, cd0: 0.0252, k: 0.038, thrustSL: 208000, cleanSpeed: 200, desMach: 0.78, desCas: 300, vapp: 130, refWeight: 56000, ...narrow },
  { id: 'A320', name: 'Airbus A320', match: ['A320', 'A20N'], wingArea: 122.6, cd0: 0.0255, k: 0.038, thrustSL: 236000, cleanSpeed: 210, desMach: 0.78, desCas: 300, vapp: 137, refWeight: 62000, ...narrow },
  { id: 'A321', name: 'Airbus A321', match: ['A321', 'A21N'], wingArea: 122.6, cd0: 0.0272, k: 0.038, thrustSL: 284000, cleanSpeed: 220, desMach: 0.78, desCas: 300, vapp: 142, refWeight: 73000, ...narrow },
  { id: 'B737', name: 'Boeing 737-700', match: ['B737', 'B37M'], wingArea: 124.6, cd0: 0.0245, k: 0.039, thrustSL: 214000, cleanSpeed: 205, desMach: 0.78, desCas: 280, vapp: 132, refWeight: 55000, ...narrow },
  { id: 'B738', name: 'Boeing 737-800', match: ['B738', 'B38M', 'B739', 'B39M'], wingArea: 124.6, cd0: 0.0255, k: 0.039, thrustSL: 234000, cleanSpeed: 210, desMach: 0.78, desCas: 280, vapp: 142, refWeight: 62000, ...narrow },
  { id: 'B752', name: 'Boeing 757-200', match: ['B752', 'B753'], wingArea: 185.3, cd0: 0.0225, k: 0.042, thrustSL: 358000, cleanSpeed: 210, desMach: 0.8, desCas: 290, vapp: 132, refWeight: 84000, ...narrow },
  { id: 'B763', name: 'Boeing 767-300', match: ['B762', 'B763', 'B764'], wingArea: 283.3, cd0: 0.0205, k: 0.044, thrustSL: 540000, cleanSpeed: 215, desMach: 0.8, desCas: 290, vapp: 140, refWeight: 130000, ...wide },
  { id: 'B772', name: 'Boeing 777-200', match: ['B772', 'B77L'], wingArea: 427.8, cd0: 0.019, k: 0.045, thrustSL: 820000, cleanSpeed: 220, desMach: 0.84, desCas: 300, vapp: 140, refWeight: 195000, ...wide },
  { id: 'B77W', name: 'Boeing 777-300ER', match: ['B77W', 'B773', 'B778', 'B779'], wingArea: 436.8, cd0: 0.0195, k: 0.045, thrustSL: 1024000, cleanSpeed: 225, desMach: 0.84, desCas: 300, vapp: 148, refWeight: 235000, ...wide },
  { id: 'B788', name: 'Boeing 787-8', match: ['B788'], wingArea: 360.5, cd0: 0.0182, k: 0.041, thrustSL: 620000, cleanSpeed: 215, desMach: 0.84, desCas: 290, vapp: 138, refWeight: 160000, ...wide },
  { id: 'B789', name: 'Boeing 787-9', match: ['B789', 'B78X'], wingArea: 360.5, cd0: 0.0186, k: 0.041, thrustSL: 660000, cleanSpeed: 220, desMach: 0.84, desCas: 290, vapp: 145, refWeight: 180000, ...wide },
  { id: 'A332', name: 'Airbus A330-200', match: ['A332', 'A338'], wingArea: 361.6, cd0: 0.0195, k: 0.039, thrustSL: 632000, cleanSpeed: 215, desMach: 0.81, desCas: 300, vapp: 136, refWeight: 170000, ...wide },
  { id: 'A333', name: 'Airbus A330-300', match: ['A333', 'A339'], wingArea: 361.6, cd0: 0.02, k: 0.039, thrustSL: 632000, cleanSpeed: 220, desMach: 0.81, desCas: 300, vapp: 138, refWeight: 175000, ...wide },
  { id: 'A359', name: 'Airbus A350-900', match: ['A359', 'A35K'], wingArea: 443, cd0: 0.0178, k: 0.039, thrustSL: 748000, cleanSpeed: 220, desMach: 0.84, desCas: 300, vapp: 140, refWeight: 195000, ...wide },
  { id: 'A388', name: 'Airbus A380-800', match: ['A388'], wingArea: 845, cd0: 0.019, k: 0.043, thrustSL: 1244000, cleanSpeed: 225, desMach: 0.84, desCas: 300, vapp: 138, refWeight: 380000, ...wide },
  { id: 'B744', name: 'Boeing 747-400', match: ['B744', 'B748', 'B74F'], wingArea: 525, cd0: 0.0195, k: 0.045, thrustSL: 1104000, cleanSpeed: 225, desMach: 0.84, desCas: 300, vapp: 148, refWeight: 270000, ...wide },
  { id: 'E175', name: 'Embraer E170/175', match: ['E170', 'E175', 'E75L', 'E75S'], wingArea: 72.7, cd0: 0.027, k: 0.041, thrustSL: 126000, cleanSpeed: 200, desMach: 0.76, desCas: 290, vapp: 128, refWeight: 33000, ...narrow },
  { id: 'E190', name: 'Embraer E190/195', match: ['E190', 'E195', 'E290', 'E295'], wingArea: 92.5, cd0: 0.0262, k: 0.041, thrustSL: 164000, cleanSpeed: 205, desMach: 0.78, desCas: 290, vapp: 132, refWeight: 43000, ...narrow },
  { id: 'CRJ9', name: 'Bombardier CRJ700/900', match: ['CRJ7', 'CRJ9', 'CRJX'], wingArea: 70.6, cd0: 0.028, k: 0.043, thrustSL: 122000, cleanSpeed: 200, desMach: 0.77, desCas: 290, vapp: 135, refWeight: 32000, ...narrow },
  { id: 'BCS3', name: 'Airbus A220', match: ['BCS1', 'BCS3'], wingArea: 112.3, cd0: 0.0235, k: 0.038, thrustSL: 208000, cleanSpeed: 205, desMach: 0.78, desCas: 290, vapp: 132, refWeight: 55000, ...narrow },
];

export function findAircraft(icao: string | undefined): Aircraft {
  const code = (icao ?? '').toUpperCase();
  return AIRCRAFT.find((a) => a.match.includes(code) || a.id === code) ?? AIRCRAFT.find((a) => a.id === 'A320')!;
}

export function aircraftById(id: string): Aircraft {
  return AIRCRAFT.find((a) => a.id === id) ?? AIRCRAFT[1];
}

export function isKnownType(icao: string | undefined): boolean {
  const code = (icao ?? '').toUpperCase();
  return AIRCRAFT.some((a) => a.match.includes(code) || a.id === code);
}
