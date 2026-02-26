import { sinDeg, cosDeg, normalizeDeg } from "./units.ts";

/** Discriminated union: either a valid hour angle or an undefined marker. */
export type HourAngleResult =
  | {
      readonly kind: "valid";
      readonly angle: number; // degrees
      readonly cosOmega: number;
      readonly clamped: boolean;
    }
  | { readonly kind: "undefined"; readonly cosOmega: number };

// Tolerance for geometric impossibility: values within this epsilon of ±1 are clamped rather than rejected
const COSINE_LIMIT_EPSILON = 1e-6;
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
  // cos(H₀) = (sin(α) − sin(φ)·sin(δ)) / (cos(φ)·cos(δ)); H₀ is the hour angle when the sun is at the target altitude
  const cosHourAngle =
    (sinDeg(alpha) - sinDeg(phi) * sinDeg(delta)) /
    (cosDeg(phi) * cosDeg(delta));

  // |cos(H₀)| > 1 + ε means the sun never reaches this altitude at this latitude/declination (polar day/night)
  if (
    cosHourAngle < -(1 + COSINE_LIMIT_EPSILON) ||
    cosHourAngle > 1 + COSINE_LIMIT_EPSILON
  ) {
    return { kind: "undefined", cosOmega: cosHourAngle };
  }

  // Floating-point noise can push cos(H₀) just outside [−1,1]; clamp without changing the result meaningfully
  const clamped = Math.abs(cosHourAngle) > 1;
  const clampedCosHourAngle = Math.max(-1, Math.min(1, cosHourAngle));
  const hourAngleDeg = Math.acos(clampedCosHourAngle) * RAD2DEG;

  return {
    kind: "valid",
    angle: hourAngleDeg,
    cosOmega: cosHourAngle,
    clamped,
  };
}

/** Convert hour angle (degrees) to time offset (hours). */
export function hourAngleToHours(omegaDeg: number): number {
  return omegaDeg / 15;
}

/** Normalize a number to [0, max). */
export function normalizeToScale(value: number, rangeMax: number): number {
  return value - rangeMax * Math.floor(value / rangeMax);
}

/** Shift angle to [-180, 180]. */
export function quadrantShiftAngle(angle: number): number {
  if (angle >= -180 && angle <= 180) return angle;
  return angle - 360 * Math.round(angle / 360);
}

/** Quadratic interpolation — Meeus p.24. */
export function interpolate(
  valueAtDate: number,
  valueYesterday: number,
  valueTomorrow: number,
  dayFraction: number,
): number {
  // First differences across the three-day window; used for the quadratic correction term
  const firstDifference = valueAtDate - valueYesterday;
  const secondDifference = valueTomorrow - valueAtDate;
  const secondDifferenceChange = secondDifference - firstDifference;
  return (
    valueAtDate +
    (dayFraction / 2) *
      (firstDifference +
        secondDifference +
        dayFraction * secondDifferenceChange)
  );
}

/** Quadratic interpolation with angle unwinding — Meeus p.24. */
export function interpolateAngles(
  valueAtDate: number,
  valueYesterday: number,
  valueTomorrow: number,
  dayFraction: number,
): number {
  // Normalize differences to handle wraparound at 0°/360° (e.g. right ascension crossing 360°)
  const firstDifference = normalizeDeg(valueAtDate - valueYesterday);
  const secondDifference = normalizeDeg(valueTomorrow - valueAtDate);
  const secondDifferenceChange = secondDifference - firstDifference;
  return (
    valueAtDate +
    (dayFraction / 2) *
      (firstDifference +
        secondDifference +
        dayFraction * secondDifferenceChange)
  );
}

/** Altitude of a celestial body — Meeus p.93. */
export function altitudeOfCelestialBody(
  observerLatitudeDeg: number,
  declinationDeg: number,
  localHourAngleDeg: number,
): number {
  return (
    Math.asin(
      sinDeg(observerLatitudeDeg) * sinDeg(declinationDeg) +
        cosDeg(observerLatitudeDeg) *
          cosDeg(declinationDeg) *
          cosDeg(localHourAngleDeg),
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
  // Meeus sign convention: west longitude is positive (Lw = −lng for east-positive input)
  const longitudeWestDeg = -lng;
  return normalizeToScale(
    (rightAscension + longitudeWestDeg - siderealTime) / 360,
    1,
  );
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
  approximateTransitFraction: number,
  lng: number,
  greenwichSiderealTimeDeg: number,
  rightAscensionAtDate: number,
  rightAscensionYesterday: number,
  rightAscensionTomorrow: number,
): number {
  // Meeus sign convention: west longitude is positive
  const longitudeWestDeg = -lng;
  // Advance sidereal time from the reference epoch to the trial transit time
  const localSiderealTimeDeg = normalizeDeg(
    greenwichSiderealTimeDeg + 360.985647 * approximateTransitFraction,
  );
  // Interpolate right ascension to the trial time using the three-day window (Meeus p.24)
  const interpolatedRightAscension = normalizeDeg(
    interpolateAngles(
      rightAscensionAtDate,
      rightAscensionYesterday,
      rightAscensionTomorrow,
      approximateTransitFraction,
    ),
  );
  // Local hour angle at transit should be ~0; the residual gives the fractional-day correction
  const localHourAngle = quadrantShiftAngle(
    localSiderealTimeDeg - longitudeWestDeg - interpolatedRightAscension,
  );
  const transitCorrection = localHourAngle / -360;
  return (approximateTransitFraction + transitCorrection) * 24;
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
  approximateTransitFraction: number,
  targetAltitudeDeg: number,
  observerLatitudeDeg: number,
  lng: number,
  afterTransit: boolean,
  greenwichSiderealTimeDeg: number,
  rightAscensionAtDate: number,
  rightAscensionYesterday: number,
  rightAscensionTomorrow: number,
  declinationAtDate: number,
  declinationYesterday: number,
  declinationTomorrow: number,
): HourAngleResult {
  // Meeus sign convention: west longitude is positive
  const longitudeWestDeg = -lng;

  // Pre-compute lat trig (reused below)
  const observerLatitudeRad = observerLatitudeDeg * DEG2RAD;
  const sinObserverLatitude = Math.sin(observerLatitudeRad);
  const cosObserverLatitude = Math.cos(observerLatitudeRad);

  // cos(H₀) = (sin(α) − sin(φ)·sin(δ)) / (cos(φ)·cos(δ)); H₀ is the hour angle when the sun is at the target altitude
  const declinationRad = declinationAtDate * DEG2RAD;
  const cosInitialHourAngle =
    (Math.sin(targetAltitudeDeg * DEG2RAD) -
      sinObserverLatitude * Math.sin(declinationRad)) /
    (cosObserverLatitude * Math.cos(declinationRad));

  // |cos(H₀)| > 1 + ε means the sun never reaches this altitude at this latitude/declination (polar day/night)
  if (
    cosInitialHourAngle < -(1 + COSINE_LIMIT_EPSILON) ||
    cosInitialHourAngle > 1 + COSINE_LIMIT_EPSILON
  ) {
    return { kind: "undefined", cosOmega: cosInitialHourAngle };
  }

  // Floating-point noise can push cos(H₀) just outside [−1,1]; clamp without changing the result meaningfully
  const clamped = Math.abs(cosInitialHourAngle) > 1;
  const clampedCos = Math.max(-1, Math.min(1, cosInitialHourAngle));
  const initialHourAngleDeg = Math.acos(clampedCos) * RAD2DEG;

  // Day fraction for the event: transit ± H₀/360 (minus for AM events, plus for PM events)
  const eventDayFraction = afterTransit
    ? approximateTransitFraction + initialHourAngleDeg / 360
    : approximateTransitFraction - initialHourAngleDeg / 360;

  // One-iteration refinement: interpolate RA/declination to the trial time, recompute altitude, apply altitude residual as dm
  const localSiderealTimeDeg = normalizeDeg(
    greenwichSiderealTimeDeg + 360.985647 * eventDayFraction,
  );
  const interpolatedRightAscension = normalizeDeg(
    interpolateAngles(
      rightAscensionAtDate,
      rightAscensionYesterday,
      rightAscensionTomorrow,
      eventDayFraction,
    ),
  );
  const interpolatedDeclination = interpolate(
    declinationAtDate,
    declinationYesterday,
    declinationTomorrow,
    eventDayFraction,
  );
  const localHourAngle =
    localSiderealTimeDeg - longitudeWestDeg - interpolatedRightAscension;

  // Inline altitudeOfCelestialBody for perf (avoid extra function call + repeated DEG2RAD mul)
  const interpolatedDeclinationRad = interpolatedDeclination * DEG2RAD;
  const localHourAngleRad = localHourAngle * DEG2RAD;
  const actualAltitudeDeg =
    Math.asin(
      sinObserverLatitude * Math.sin(interpolatedDeclinationRad) +
        cosObserverLatitude *
          Math.cos(interpolatedDeclinationRad) *
          Math.cos(localHourAngleRad),
    ) * RAD2DEG;

  const eventCorrection =
    (actualAltitudeDeg - targetAltitudeDeg) /
    (360 *
      Math.cos(interpolatedDeclinationRad) *
      cosObserverLatitude *
      Math.sin(localHourAngleRad));

  const eventUtcHours = (eventDayFraction + eventCorrection) * 24;

  return {
    kind: "valid",
    angle: eventUtcHours,
    cosOmega: cosInitialHourAngle,
    clamped,
  };
}

/**
 * Corrected hour angle — fast variant with pre-computed latitude trig.
 * Used internally by computePrayerTimes to avoid recomputing sinObserverLatitude/cosObserverLatitude
 * for each of the 5 CHA calls.
 */
export function correctedHourAngleFast(
  approximateTransitFraction: number,
  targetAltitudeDeg: number,
  sinObserverLatitude: number,
  cosObserverLatitude: number,
  longitudeWestDeg: number,
  afterTransit: boolean,
  greenwichSiderealTimeDeg: number,
  rightAscensionAtDate: number,
  rightAscensionYesterday: number,
  rightAscensionTomorrow: number,
  declinationAtDate: number,
  declinationYesterday: number,
  declinationTomorrow: number,
): HourAngleResult {
  // cos(H₀) = (sin(α) − sin(φ)·sin(δ)) / (cos(φ)·cos(δ)); H₀ is the hour angle when the sun is at the target altitude
  const declinationRad = declinationAtDate * DEG2RAD;
  const cosInitialHourAngle =
    (Math.sin(targetAltitudeDeg * DEG2RAD) -
      sinObserverLatitude * Math.sin(declinationRad)) /
    (cosObserverLatitude * Math.cos(declinationRad));

  // |cos(H₀)| > 1 + ε means the sun never reaches this altitude at this latitude/declination (polar day/night)
  if (
    cosInitialHourAngle < -(1 + COSINE_LIMIT_EPSILON) ||
    cosInitialHourAngle > 1 + COSINE_LIMIT_EPSILON
  ) {
    return { kind: "undefined", cosOmega: cosInitialHourAngle };
  }

  // Floating-point noise can push cos(H₀) just outside [−1,1]; clamp without changing the result meaningfully
  const clamped = Math.abs(cosInitialHourAngle) > 1;
  const clampedCos = Math.max(-1, Math.min(1, cosInitialHourAngle));
  const initialHourAngleDeg = Math.acos(clampedCos) * RAD2DEG;

  // Day fraction for the event: transit ± H₀/360 (minus for AM events, plus for PM events)
  const eventDayFraction = afterTransit
    ? approximateTransitFraction + initialHourAngleDeg / 360
    : approximateTransitFraction - initialHourAngleDeg / 360;

  // One-iteration refinement: interpolate RA/declination to the trial time, recompute altitude, apply altitude residual as dm
  const localSiderealTimeDeg = normalizeDeg(
    greenwichSiderealTimeDeg + 360.985647 * eventDayFraction,
  );
  const interpolatedRightAscension = normalizeDeg(
    interpolateAngles(
      rightAscensionAtDate,
      rightAscensionYesterday,
      rightAscensionTomorrow,
      eventDayFraction,
    ),
  );
  const interpolatedDeclination = interpolate(
    declinationAtDate,
    declinationYesterday,
    declinationTomorrow,
    eventDayFraction,
  );
  const localHourAngle =
    localSiderealTimeDeg - longitudeWestDeg - interpolatedRightAscension;

  const interpolatedDeclinationRad = interpolatedDeclination * DEG2RAD;
  const localHourAngleRad = localHourAngle * DEG2RAD;
  const actualAltitudeDeg =
    Math.asin(
      sinObserverLatitude * Math.sin(interpolatedDeclinationRad) +
        cosObserverLatitude *
          Math.cos(interpolatedDeclinationRad) *
          Math.cos(localHourAngleRad),
    ) * RAD2DEG;

  const eventCorrection =
    (actualAltitudeDeg - targetAltitudeDeg) /
    (360 *
      Math.cos(interpolatedDeclinationRad) *
      cosObserverLatitude *
      Math.sin(localHourAngleRad));

  return {
    kind: "valid",
    angle: (eventDayFraction + eventCorrection) * 24,
    cosOmega: cosInitialHourAngle,
    clamped,
  };
}
