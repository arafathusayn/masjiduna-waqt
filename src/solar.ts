import { sinDeg, cosDeg, normalizeDeg, atan2Deg } from "./units.ts";

// ============================================================
// Solar position — all plain `number`, no branded types.
// ============================================================

export interface SolarPosition {
  /** Sun's declination (degrees) */
  readonly declination: number;
  /** Equation of time (minutes) */
  readonly eqtMinutes: number;
  /** Apparent ecliptic longitude (degrees) */
  readonly eclipticLong: number;
  /** Corrected obliquity of ecliptic (degrees) */
  readonly obliquity: number;
  /** Right ascension (degrees, 0-360) */
  readonly rightAscension: number;
  /** Apparent sidereal time at Greenwich (degrees) */
  readonly apparentSiderealTime: number;
}

const DEG2RAD = Math.PI / 180;

/** Julian Date from a UTC calendar date. Valid 1901–2099+ with full Meeus formula. */
export function toJulianDate(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day +
    B -
    1524.5
  );
}

/** Julian Century from Julian Date (offset from J2000.0 epoch). */
export function toJulianCentury(julianDate: number): number {
  return (julianDate - 2451545.0) / 36525.0;
}

// ============================================================
// Nutation & sidereal time — Meeus Chapter 22 / p.144 / p.88
// ============================================================

/** Mean lunar longitude (Meeus p.144). */
export function meanLunarLongitude(T: number): number {
  return normalizeDeg(218.3165 + 481267.8813 * T);
}

/** Longitude of the ascending lunar node (Meeus p.144). */
export function ascendingLunarNodeLongitude(T: number): number {
  return normalizeDeg(
    125.04452 - 1934.136261 * T + 0.0020708 * T * T + (T * T * T) / 450000,
  );
}

/** Nutation in longitude ΔΨ (degrees) — Meeus p.144 low-precision. */
export function nutationInLongitude(
  L0: number,
  Lp: number,
  Omega: number,
): number {
  const OmegaRad = Omega * DEG2RAD;
  return (
    (-17.2 / 3600) * Math.sin(OmegaRad) -
    (1.32 / 3600) * Math.sin(2 * L0 * DEG2RAD) -
    (0.23 / 3600) * Math.sin(2 * Lp * DEG2RAD) +
    (0.21 / 3600) * Math.sin(2 * OmegaRad)
  );
}

/** Nutation in obliquity Δε (degrees) — Meeus p.144 low-precision. */
export function nutationInObliquity(
  L0: number,
  Lp: number,
  Omega: number,
): number {
  const OmegaRad = Omega * DEG2RAD;
  return (
    (9.2 / 3600) * Math.cos(OmegaRad) +
    (0.57 / 3600) * Math.cos(2 * L0 * DEG2RAD) +
    (0.1 / 3600) * Math.cos(2 * Lp * DEG2RAD) -
    (0.09 / 3600) * Math.cos(2 * OmegaRad)
  );
}

/** Mean sidereal time at Greenwich (degrees) — Meeus p.88. */
export function meanSiderealTime(T: number): number {
  const JD = T * 36525 + 2451545.0;
  return normalizeDeg(
    280.46061837 +
      360.98564736629 * (JD - 2451545) +
      0.000387933 * T * T -
      (T * T * T) / 38710000,
  );
}

// ============================================================
// Individual astronomical functions — Meeus Chapter 12–15
// Extracted from solarPosition() for independent testability.
// ============================================================

/** Geometric mean longitude of the sun (degrees) — Meeus p.163. */
export function meanSolarLongitude(T: number): number {
  return normalizeDeg(280.4664567 + 36000.76983 * T + 0.0003032 * T * T);
}

/** Mean anomaly of the sun (degrees) — Meeus p.163. */
export function meanSolarAnomaly(T: number): number {
  return normalizeDeg(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
}

/** Sun's equation of the center (degrees) — Meeus p.164. */
export function solarEquationOfTheCenter(T: number, M: number): number {
  const MRad = M * DEG2RAD;
  const sinM = Math.sin(MRad);
  return (
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sinM +
    (0.019993 - 0.000101 * T) * Math.sin(2 * MRad) +
    0.000289 * Math.sin(3 * MRad)
  );
}

/** Apparent solar longitude (degrees) — Meeus p.164. */
export function apparentSolarLongitude(T: number, L0: number): number {
  const M = meanSolarAnomaly(T);
  const C = solarEquationOfTheCenter(T, M);
  const Ltrue = normalizeDeg(L0 + C);
  const omega = 125.04 - 1934.136 * T;
  return Ltrue - 0.00569 - 0.00478 * sinDeg(omega);
}

/** Mean obliquity of the ecliptic (degrees) — Meeus p.147. */
export function meanObliquityOfTheEcliptic(T: number): number {
  return (
    23.439291 -
    0.013004167 * T -
    0.0000001639 * T * T +
    0.0000005036 * T * T * T
  );
}

/** Apparent obliquity of the ecliptic (degrees) — Meeus p.165.
 *  Uses simplified 0.00256·cos(Ω) correction. */
export function apparentObliquityOfTheEcliptic(
  T: number,
  eps0: number,
): number {
  const O = 125.04 - 1934.136 * T;
  return eps0 + 0.00256 * cosDeg(O);
}

// ============================================================
// Full Meeus solar position
// ============================================================

/** Full Meeus algorithm — returns declination, RA, sidereal time, etc. */
export function solarPosition(julianDate: number): SolarPosition {
  const T = toJulianCentury(julianDate);
  const T2 = T * T;

  // Geometric mean longitude (degrees)
  const L0 = normalizeDeg(280.4664567 + 36000.76983 * T + 0.0003032 * T2);
  // Mean anomaly (degrees)
  const M = normalizeDeg(357.52911 + 35999.05029 * T - 0.0001537 * T2);
  // Orbital eccentricity
  const eOrb = 0.016708634 - 0.000042037 * T - 0.0000001267 * T2;

  // Equation of the center (inline for shared MRad/sinM)
  const MRad = M * DEG2RAD;
  const sinM = Math.sin(MRad);
  const cosM = Math.cos(MRad);
  const sin2M = 2 * sinM * cosM; // sin(2M) via double-angle
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T2) * sinM +
    (0.019993 - 0.000101 * T) * sin2M +
    0.000289 * (3 * sinM - 4 * sinM * sinM * sinM); // sin(3M) = 3sinM - 4sin³M

  // Apparent longitude
  const Ltrue = normalizeDeg(L0 + C);
  const omega = 125.04 - 1934.136 * T;
  const lambda = Ltrue - 0.00569 - 0.00478 * Math.sin(omega * DEG2RAD);

  // Obliquity (Meeus p.147)
  const T3 = T2 * T;
  const eps0 =
    23.439291 - 0.013004167 * T - 0.0000001639 * T2 + 0.0000005036 * T3;

  // Nutation (inline to share trig values between dPsi/dEpsilon and EoT)
  const Lp = 218.3165 + 481267.8813 * T; // skip normalization — only used in sin/cos
  const Omega = 125.04452 - 1934.136261 * T + 0.0020708 * T2 + T3 / 450000;

  const OmegaRad = Omega * DEG2RAD;
  const sinOmega = Math.sin(OmegaRad);
  const cosOmega = Math.cos(OmegaRad);
  const sin2Omega = 2 * sinOmega * cosOmega;
  const cos2Omega = cosOmega * cosOmega - sinOmega * sinOmega;
  const L0Rad = L0 * DEG2RAD;
  const sin2L0 = Math.sin(2 * L0Rad);
  const cos2L0 = Math.cos(2 * L0Rad);
  const sin2Lp = Math.sin(2 * Lp * DEG2RAD);
  const cos2Lp = Math.cos(2 * Lp * DEG2RAD);

  const dPsi =
    (-17.2 / 3600) * sinOmega -
    (1.32 / 3600) * sin2L0 -
    (0.23 / 3600) * sin2Lp +
    (0.21 / 3600) * sin2Omega;

  const dEpsilon =
    (9.2 / 3600) * cosOmega +
    (0.57 / 3600) * cos2L0 +
    (0.1 / 3600) * cos2Lp -
    (0.09 / 3600) * cos2Omega;

  // Corrected obliquity
  const eps = eps0 + dEpsilon;

  // Declination and RA (shared trig)
  const epsRad = eps * DEG2RAD;
  const lambdaRad = lambda * DEG2RAD;
  const sinLambda = Math.sin(lambdaRad);
  const cosLambda = Math.cos(lambdaRad);
  const sinEps = Math.sin(epsRad);
  const cosEps = Math.cos(epsRad);

  const declination = Math.asin(sinEps * sinLambda) / DEG2RAD;
  const rightAscension = normalizeDeg(
    Math.atan2(cosEps * sinLambda, cosLambda) / DEG2RAD,
  );

  // Apparent sidereal time (Meeus p.88)
  const JD = T * 36525 + 2451545.0;
  const Theta0 = normalizeDeg(
    280.46061837 +
      360.98564736629 * (JD - 2451545) +
      0.000387933 * T2 -
      T3 / 38710000,
  );
  const apparentSiderealTime = Theta0 + dPsi * Math.cos(eps * DEG2RAD);

  // Equation of time — reuse sin2L0, cos2L0, sinM from above
  const halfEpsRad = epsRad / 2;
  const tanHalf = Math.tan(halfEpsRad);
  const y = tanHalf * tanHalf;
  const sin4L0 = 2 * sin2L0 * cos2L0; // sin(4L0) via double-angle of 2L0
  const eqtRad =
    y * sin2L0 -
    2 * eOrb * sinM +
    4 * eOrb * y * sinM * cos2L0 -
    0.5 * y * y * sin4L0 -
    1.25 * eOrb * eOrb * sin2M;

  return {
    declination,
    eqtMinutes: eqtRad * 229.18,
    eclipticLong: lambda,
    obliquity: eps,
    rightAscension,
    apparentSiderealTime,
  };
}
