import { sinDeg, cosDeg, normalizeDeg } from "./units.ts";

// ============================================================
// Hour angle — the single most important equation in prayer
// time calculation. All parameters are plain numbers (degrees).
// ============================================================

/** Discriminated union: either a valid hour angle or an undefined marker. */
export type HourAngleResult =
  | {
      readonly kind: "valid";
      readonly angle: number; // degrees
      readonly cosOmega: number;
      readonly clamped: boolean;
    }
  | { readonly kind: "undefined"; readonly cosOmega: number };

const EPSILON = 1e-6;
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/**
 * Compute the hour angle for a target sun altitude.
 *
 * @param alpha - Target sun altitude (degrees, negative = below horizon)
 * @param phi   - Observer latitude (degrees)
 * @param delta - Sun declination (degrees)
 * @returns Discriminated union — caller MUST handle the "undefined" branch.
 */
export function computeHourAngle(
  alpha: number,
  phi: number,
  delta: number,
): HourAngleResult {
  const cosOmega =
    (sinDeg(alpha) - sinDeg(phi) * sinDeg(delta)) /
    (cosDeg(phi) * cosDeg(delta));

  // True geometric impossibility
  if (cosOmega < -(1 + EPSILON) || cosOmega > 1 + EPSILON) {
    return { kind: "undefined", cosOmega };
  }

  // Clamp floating-point noise
  const clamped = Math.abs(cosOmega) > 1;
  const safe = Math.max(-1, Math.min(1, cosOmega));
  const omegaDeg = Math.acos(safe) * RAD2DEG;

  return { kind: "valid", angle: omegaDeg, cosOmega, clamped };
}

/** Convert hour angle (degrees) to time offset (hours). */
export function hourAngleToHours(omegaDeg: number): number {
  return omegaDeg / 15;
}

// ============================================================
// Meeus Chapter 15 — corrected transit and hour angles using
// 3-day interpolation of right ascension and declination.
// ============================================================

/** Normalize a number to [0, max). */
export function normalizeToScale(num: number, max: number): number {
  return num - max * Math.floor(num / max);
}

/** Shift angle to [-180, 180]. */
export function quadrantShiftAngle(angle: number): number {
  if (angle >= -180 && angle <= 180) return angle;
  return angle - 360 * Math.round(angle / 360);
}

/** Quadratic interpolation — Meeus p.24. */
export function interpolate(
  y2: number,
  y1: number,
  y3: number,
  n: number,
): number {
  const a = y2 - y1;
  const b = y3 - y2;
  const c = b - a;
  return y2 + (n / 2) * (a + b + n * c);
}

/** Quadratic interpolation with angle unwinding — Meeus p.24. */
export function interpolateAngles(
  y2: number,
  y1: number,
  y3: number,
  n: number,
): number {
  const a = normalizeDeg(y2 - y1);
  const b = normalizeDeg(y3 - y2);
  const c = b - a;
  return y2 + (n / 2) * (a + b + n * c);
}

/** Altitude of a celestial body — Meeus p.93. */
export function altitudeOfCelestialBody(
  phi: number,
  delta: number,
  H: number,
): number {
  return (
    Math.asin(
      sinDeg(phi) * sinDeg(delta) + cosDeg(phi) * cosDeg(delta) * cosDeg(H),
    ) * RAD2DEG
  );
}

/**
 * Approximate transit as a day fraction (0–1) — Meeus p.102.
 *
 * @param lng - Observer longitude (degrees, positive east)
 * @param siderealTime - Apparent sidereal time at Greenwich (degrees)
 * @param rightAscension - Right ascension of the sun (degrees)
 */
export function approximateTransit(
  lng: number,
  siderealTime: number,
  rightAscension: number,
): number {
  const Lw = -lng;
  return normalizeToScale((rightAscension + Lw - siderealTime) / 360, 1);
}

/**
 * Corrected transit — Meeus p.102.
 * Returns UTC hours of solar noon.
 *
 * @param m0 - Approximate transit (day fraction)
 * @param lng - Observer longitude (degrees, positive east)
 * @param Theta0 - Apparent sidereal time at Greenwich (degrees)
 * @param a2 - RA on the date (degrees)
 * @param a1 - RA on the previous day (degrees)
 * @param a3 - RA on the next day (degrees)
 */
export function correctedTransit(
  m0: number,
  lng: number,
  Theta0: number,
  a2: number,
  a1: number,
  a3: number,
): number {
  const Lw = -lng;
  const Theta = normalizeDeg(Theta0 + 360.985647 * m0);
  const a = normalizeDeg(interpolateAngles(a2, a1, a3, m0));
  const H = quadrantShiftAngle(Theta - Lw - a);
  const dm = H / -360;
  return (m0 + dm) * 24;
}

/**
 * Corrected hour angle — Meeus p.102.
 * Returns UTC hours for the event (sunrise, sunset, Fajr, Isha, etc.).
 *
 * @param m0 - Approximate transit (day fraction)
 * @param angle - Target sun altitude (degrees, negative = below horizon)
 * @param lat - Observer latitude (degrees)
 * @param lng - Observer longitude (degrees, positive east)
 * @param afterTransit - true for events after noon (sunset, Isha), false for before (sunrise, Fajr)
 * @param Theta0 - Apparent sidereal time at Greenwich (degrees)
 * @param a2 - RA on the date (degrees)
 * @param a1 - RA on the previous day (degrees)
 * @param a3 - RA on the next day (degrees)
 * @param d2 - Declination on the date (degrees)
 * @param d1 - Declination on the previous day (degrees)
 * @param d3 - Declination on the next day (degrees)
 * @returns HourAngleResult with UTC hours (in valid.angle) or undefined
 */
export function correctedHourAngle(
  m0: number,
  angle: number,
  lat: number,
  lng: number,
  afterTransit: boolean,
  Theta0: number,
  a2: number,
  a1: number,
  a3: number,
  d2: number,
  d1: number,
  d3: number,
): HourAngleResult {
  const Lw = -lng;

  // Pre-compute lat trig (reused below)
  const latRad = lat * DEG2RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);

  // Initial hour angle from day-of declination
  const d2Rad = d2 * DEG2RAD;
  const cosH0 =
    (Math.sin(angle * DEG2RAD) - sinLat * Math.sin(d2Rad)) /
    (cosLat * Math.cos(d2Rad));

  // Check solvability
  if (cosH0 < -(1 + EPSILON) || cosH0 > 1 + EPSILON) {
    return { kind: "undefined", cosOmega: cosH0 };
  }

  const clamped = Math.abs(cosH0) > 1;
  const safeCos = Math.max(-1, Math.min(1, cosH0));
  const H0 = Math.acos(safeCos) * RAD2DEG;

  const m = afterTransit ? m0 + H0 / 360 : m0 - H0 / 360;

  // Iterative correction (one pass)
  const Theta = normalizeDeg(Theta0 + 360.985647 * m);
  const a = normalizeDeg(interpolateAngles(a2, a1, a3, m));
  const delta = interpolate(d2, d1, d3, m);
  const H = Theta - Lw - a;

  // Inline altitudeOfCelestialBody for perf (avoid extra function call + repeated DEG2RAD mul)
  const deltaRad = delta * DEG2RAD;
  const HRad = H * DEG2RAD;
  const h =
    Math.asin(
      sinLat * Math.sin(deltaRad) +
        cosLat * Math.cos(deltaRad) * Math.cos(HRad),
    ) * RAD2DEG;

  const dm = (h - angle) / (360 * Math.cos(deltaRad) * cosLat * Math.sin(HRad));

  const utcHours = (m + dm) * 24;

  return { kind: "valid", angle: utcHours, cosOmega: cosH0, clamped };
}

/**
 * Corrected hour angle — fast variant with pre-computed latitude trig.
 * Used internally by computePrayerTimes to avoid recomputing sinLat/cosLat
 * for each of the 5 CHA calls.
 */
export function correctedHourAngleFast(
  m0: number,
  angle: number,
  sinLat: number,
  cosLat: number,
  Lw: number,
  afterTransit: boolean,
  Theta0: number,
  a2: number,
  a1: number,
  a3: number,
  d2: number,
  d1: number,
  d3: number,
): HourAngleResult {
  // Initial hour angle from day-of declination
  const d2Rad = d2 * DEG2RAD;
  const cosH0 =
    (Math.sin(angle * DEG2RAD) - sinLat * Math.sin(d2Rad)) /
    (cosLat * Math.cos(d2Rad));

  // Check solvability
  if (cosH0 < -(1 + EPSILON) || cosH0 > 1 + EPSILON) {
    return { kind: "undefined", cosOmega: cosH0 };
  }

  const clamped = Math.abs(cosH0) > 1;
  const safeCos = Math.max(-1, Math.min(1, cosH0));
  const H0 = Math.acos(safeCos) * RAD2DEG;

  const m = afterTransit ? m0 + H0 / 360 : m0 - H0 / 360;

  // Iterative correction (one pass)
  const Theta = normalizeDeg(Theta0 + 360.985647 * m);
  const a = normalizeDeg(interpolateAngles(a2, a1, a3, m));
  const delta = interpolate(d2, d1, d3, m);
  const H = Theta - Lw - a;

  const deltaRad = delta * DEG2RAD;
  const HRad = H * DEG2RAD;
  const h =
    Math.asin(
      sinLat * Math.sin(deltaRad) +
        cosLat * Math.cos(deltaRad) * Math.cos(HRad),
    ) * RAD2DEG;

  const dm = (h - angle) / (360 * Math.cos(deltaRad) * cosLat * Math.sin(HRad));

  return { kind: "valid", angle: (m + dm) * 24, cosOmega: cosH0, clamped };
}
