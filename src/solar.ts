import { sinDeg, cosDeg, normalizeDeg, atan2Deg } from "./units.ts";

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

/** Mean lunar longitude (Meeus p.144). */
export function meanLunarLongitude(julianCentury: number): number {
  return normalizeDeg(218.3165 + 481267.8813 * julianCentury);
}

/** Longitude of the ascending lunar node (Meeus p.144). */
export function ascendingLunarNodeLongitude(julianCentury: number): number {
  return normalizeDeg(
    125.04452 -
      1934.136261 * julianCentury +
      0.0020708 * julianCentury * julianCentury +
      (julianCentury * julianCentury * julianCentury) / 450000,
  );
}

/** Nutation in longitude ΔΨ (degrees) — Meeus p.144 low-precision. */
export function nutationInLongitude(
  meanSolarLongitudeDeg: number,
  meanLunarLongitudeDeg: number,
  lunarAscendingNodeDeg: number,
): number {
  const lunarNodeRad = lunarAscendingNodeDeg * DEG2RAD;
  return (
    (-17.2 / 3600) * Math.sin(lunarNodeRad) -
    (1.32 / 3600) * Math.sin(2 * meanSolarLongitudeDeg * DEG2RAD) -
    (0.23 / 3600) * Math.sin(2 * meanLunarLongitudeDeg * DEG2RAD) +
    (0.21 / 3600) * Math.sin(2 * lunarNodeRad)
  );
}

/** Nutation in obliquity Δε (degrees) — Meeus p.144 low-precision. */
export function nutationInObliquity(
  meanSolarLongitudeDeg: number,
  meanLunarLongitudeDeg: number,
  lunarAscendingNodeDeg: number,
): number {
  const lunarNodeRad = lunarAscendingNodeDeg * DEG2RAD;
  return (
    (9.2 / 3600) * Math.cos(lunarNodeRad) +
    (0.57 / 3600) * Math.cos(2 * meanSolarLongitudeDeg * DEG2RAD) +
    (0.1 / 3600) * Math.cos(2 * meanLunarLongitudeDeg * DEG2RAD) -
    (0.09 / 3600) * Math.cos(2 * lunarNodeRad)
  );
}

/** Mean sidereal time at Greenwich (degrees) — Meeus p.88. */
export function meanSiderealTime(julianCentury: number): number {
  const julianDate = julianCentury * 36525 + 2451545.0;
  return normalizeDeg(
    280.46061837 +
      360.98564736629 * (julianDate - 2451545) +
      0.000387933 * julianCentury * julianCentury -
      (julianCentury * julianCentury * julianCentury) / 38710000,
  );
}

/** Geometric mean longitude of the sun (degrees) — Meeus p.163. */
export function meanSolarLongitude(julianCentury: number): number {
  return normalizeDeg(
    280.4664567 +
      36000.76983 * julianCentury +
      0.0003032 * julianCentury * julianCentury,
  );
}

/** Mean anomaly of the sun (degrees) — Meeus p.163. */
export function meanSolarAnomaly(julianCentury: number): number {
  return normalizeDeg(
    357.52911 +
      35999.05029 * julianCentury -
      0.0001537 * julianCentury * julianCentury,
  );
}

/** Sun's equation of the center (degrees) — Meeus p.164. */
export function solarEquationOfTheCenter(
  julianCentury: number,
  meanAnomalyDeg: number,
): number {
  const meanAnomalyRad = meanAnomalyDeg * DEG2RAD;
  const sinMeanAnomaly = Math.sin(meanAnomalyRad);
  return (
    (1.914602 -
      0.004817 * julianCentury -
      0.000014 * julianCentury * julianCentury) *
      sinMeanAnomaly +
    (0.019993 - 0.000101 * julianCentury) * Math.sin(2 * meanAnomalyRad) +
    0.000289 * Math.sin(3 * meanAnomalyRad)
  );
}

/** Apparent solar longitude (degrees) — Meeus p.164. */
export function apparentSolarLongitude(
  julianCentury: number,
  meanSolarLongitudeDeg: number,
): number {
  const meanAnomalyDeg = meanSolarAnomaly(julianCentury);
  const equationOfCenterDeg = solarEquationOfTheCenter(
    julianCentury,
    meanAnomalyDeg,
  );
  // True geometric longitude = mean longitude + equation of center
  const trueSolarLongitudeDeg = normalizeDeg(
    meanSolarLongitudeDeg + equationOfCenterDeg,
  );
  // Apparent longitude accounts for nutation (ΔΨ) and aberration (the −0.00569 − 0.00478·sin(Ω) correction)
  const moonAscendingNodeLongitudeDeg = 125.04 - 1934.136 * julianCentury;
  return (
    trueSolarLongitudeDeg -
    0.00569 -
    0.00478 * sinDeg(moonAscendingNodeLongitudeDeg)
  );
}

/** Mean obliquity of the ecliptic (degrees) — Meeus p.147. */
export function meanObliquityOfTheEcliptic(julianCentury: number): number {
  return (
    23.439291 -
    0.013004167 * julianCentury -
    0.0000001639 * julianCentury * julianCentury +
    0.0000005036 * julianCentury * julianCentury * julianCentury
  );
}

/** Apparent obliquity of the ecliptic (degrees) — Meeus p.165.
 *  Uses simplified 0.00256·cos(Ω) correction. */
export function apparentObliquityOfTheEcliptic(
  julianCentury: number,
  meanObliquityDeg: number,
): number {
  const O = 125.04 - 1934.136 * julianCentury;
  return meanObliquityDeg + 0.00256 * cosDeg(O);
}

/** Full Meeus algorithm — returns declination, RA, sidereal time, etc. */
export function solarPosition(julianDate: number): SolarPosition {
  // Julian centuries elapsed since J2000.0 epoch; Meeus uses this as the independent variable for all solar series
  const julianCentury = toJulianCentury(julianDate);
  const julianCenturySquared = julianCentury * julianCentury;

  // Geometric mean longitude of the sun, before nutation and aberration corrections (Meeus p.163)
  const meanSolarLongitudeDeg = normalizeDeg(
    280.4664567 +
      36000.76983 * julianCentury +
      0.0003032 * julianCenturySquared,
  );
  // Angular distance the sun has traveled from perihelion; drives the equation of the center
  const meanAnomalyDeg = normalizeDeg(
    357.52911 + 35999.05029 * julianCentury - 0.0001537 * julianCenturySquared,
  );
  // Orbital eccentricity of Earth's ellipse around the Sun; slowly decreasing over centuries
  const orbitalEccentricity =
    0.016708634 -
    0.000042037 * julianCentury -
    0.0000001267 * julianCenturySquared;

  // Equation of the center (inline for shared meanAnomalyRad/sinMeanAnomaly)
  const meanAnomalyRad = meanAnomalyDeg * DEG2RAD;
  const sinMeanAnomaly = Math.sin(meanAnomalyRad);
  const cosMeanAnomaly = Math.cos(meanAnomalyRad);
  const sinTwiceMeanAnomaly = 2 * sinMeanAnomaly * cosMeanAnomaly; // sin(2M) via double-angle
  // Difference between the sun's true anomaly and mean anomaly; converts uniform orbital motion to actual elliptical motion
  const equationOfCenterDeg =
    (1.914602 - 0.004817 * julianCentury - 0.000014 * julianCenturySquared) *
      sinMeanAnomaly +
    (0.019993 - 0.000101 * julianCentury) * sinTwiceMeanAnomaly +
    0.000289 *
      (3 * sinMeanAnomaly -
        4 * sinMeanAnomaly * sinMeanAnomaly * sinMeanAnomaly); // sin(3M) = 3sinM - 4sin³M

  // True geometric longitude = mean longitude + equation of center
  const trueSolarLongitudeDeg = normalizeDeg(
    meanSolarLongitudeDeg + equationOfCenterDeg,
  );
  // Apparent longitude accounts for nutation (ΔΨ) and aberration (the −0.00569 − 0.00478·sin(Ω) correction)
  const moonAscendingNodeLongitudeDeg = 125.04 - 1934.136 * julianCentury;
  const apparentSolarLongitudeDeg =
    trueSolarLongitudeDeg -
    0.00569 -
    0.00478 * Math.sin(moonAscendingNodeLongitudeDeg * DEG2RAD);

  // Tilt of Earth's rotational axis relative to the ecliptic plane; slowly decreasing over centuries
  const julianCenturyCubed = julianCenturySquared * julianCentury;
  const meanObliquityDeg =
    23.439291 -
    0.013004167 * julianCentury -
    0.0000001639 * julianCenturySquared +
    0.0000005036 * julianCenturyCubed;

  // Nutation (inline to share trig values between nutationInLongitudeDeg/nutationInObliquityDeg and EoT)
  const meanLunarLongitudeDeg = 218.3165 + 481267.8813 * julianCentury; // skip normalization — only used in sin/cos
  const lunarAscendingNodeDeg =
    125.04452 -
    1934.136261 * julianCentury +
    0.0020708 * julianCenturySquared +
    julianCenturyCubed / 450000;

  const lunarNodeRad = lunarAscendingNodeDeg * DEG2RAD;
  const sinLunarNode = Math.sin(lunarNodeRad);
  const cosLunarNode = Math.cos(lunarNodeRad);
  const sinTwiceLunarNode = 2 * sinLunarNode * cosLunarNode;
  const cosTwiceLunarNode =
    cosLunarNode * cosLunarNode - sinLunarNode * sinLunarNode;
  const meanLongitudeRad = meanSolarLongitudeDeg * DEG2RAD;
  const sinTwiceMeanLongitude = Math.sin(2 * meanLongitudeRad);
  const cosTwiceMeanLongitude = Math.cos(2 * meanLongitudeRad);
  const sinTwiceLunarLongitude = Math.sin(2 * meanLunarLongitudeDeg * DEG2RAD);
  const cosTwiceLunarLongitude = Math.cos(2 * meanLunarLongitudeDeg * DEG2RAD);

  // Short-period wobble of Earth's axis in the ecliptic plane direction, caused primarily by the Moon's gravity
  const nutationInLongitudeDeg =
    (-17.2 / 3600) * sinLunarNode -
    (1.32 / 3600) * sinTwiceMeanLongitude -
    (0.23 / 3600) * sinTwiceLunarLongitude +
    (0.21 / 3600) * sinTwiceLunarNode;

  // Short-period wobble perpendicular to nutationInLongitudeDeg; corrects the obliquity
  const nutationInObliquityDeg =
    (9.2 / 3600) * cosLunarNode +
    (0.57 / 3600) * cosTwiceMeanLongitude +
    (0.1 / 3600) * cosTwiceLunarLongitude -
    (0.09 / 3600) * cosTwiceLunarNode;

  // True obliquity = mean obliquity + nutation correction
  const correctedObliquityDeg = meanObliquityDeg + nutationInObliquityDeg;

  // Declination and RA (shared trig)
  const correctedObliquityRad = correctedObliquityDeg * DEG2RAD;
  const apparentLongitudeRad = apparentSolarLongitudeDeg * DEG2RAD;
  const sinApparentLongitude = Math.sin(apparentLongitudeRad);
  const cosApparentLongitude = Math.cos(apparentLongitudeRad);
  const sinObliquity = Math.sin(correctedObliquityRad);
  const cosObliquity = Math.cos(correctedObliquityRad);

  // Declination: angular distance of the sun north/south of the celestial equator
  const declination = Math.asin(sinObliquity * sinApparentLongitude) / DEG2RAD;
  // Right ascension: ecliptic longitude projected onto the equatorial plane
  const rightAscension = normalizeDeg(
    Math.atan2(cosObliquity * sinApparentLongitude, cosApparentLongitude) /
      DEG2RAD,
  );

  // Apparent sidereal time: Greenwich hour angle of the vernal equinox, corrected for nutation (Meeus p.88)
  const julianDateFromCentury = julianCentury * 36525 + 2451545.0;
  const meanGreenwichSiderealTimeDeg = normalizeDeg(
    280.46061837 +
      360.98564736629 * (julianDateFromCentury - 2451545) +
      0.000387933 * julianCenturySquared -
      julianCenturyCubed / 38710000,
  );
  const apparentSiderealTime =
    meanGreenwichSiderealTimeDeg +
    nutationInLongitudeDeg * Math.cos(correctedObliquityDeg * DEG2RAD);

  // Equation of time: difference between apparent solar time and mean solar time, used to find solar noon
  // Reuse sinTwiceMeanLongitude, cosTwiceMeanLongitude, sinMeanAnomaly from above
  const halfObliquityRad = correctedObliquityRad / 2;
  const tanHalfObliquity = Math.tan(halfObliquityRad);
  // y = tan²(ε/2): a compact factor encoding the obliquity's effect on the equation of time
  const eccentricityFactor = tanHalfObliquity * tanHalfObliquity;
  const sinFourTimesMeanLongitude =
    2 * sinTwiceMeanLongitude * cosTwiceMeanLongitude; // sin(4L0) via double-angle of 2L0
  const equationOfTimeRad =
    eccentricityFactor * sinTwiceMeanLongitude -
    2 * orbitalEccentricity * sinMeanAnomaly +
    4 *
      orbitalEccentricity *
      eccentricityFactor *
      sinMeanAnomaly *
      cosTwiceMeanLongitude -
    0.5 * eccentricityFactor * eccentricityFactor * sinFourTimesMeanLongitude -
    1.25 * orbitalEccentricity * orbitalEccentricity * sinTwiceMeanAnomaly;

  return {
    declination,
    eqtMinutes: equationOfTimeRad * 229.18,
    eclipticLong: apparentSolarLongitudeDeg,
    obliquity: correctedObliquityDeg,
    rightAscension,
    apparentSiderealTime,
  };
}
