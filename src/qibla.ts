import { normalizeDeg } from "./units.ts";

const MAKKAH_LAT = 21.4225241;
const MAKKAH_LNG = 39.8261818;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Pre-compute Makkah trig constants (invariant)
const MAKKAH_LNG_RAD = MAKKAH_LNG * DEG2RAD;
const TAN_MAKKAH_LAT = Math.tan(MAKKAH_LAT * DEG2RAD);

/**
 * Compute the Qibla direction (bearing in degrees from North).
 *
 * @param lat - Observer latitude (degrees)
 * @param lng - Observer longitude (degrees)
 * @returns Bearing in degrees [0, 360)
 */
export function computeQibla(lat: number, lng: number): number {
  // Great-circle bearing formula requires the longitude difference in radians
  const longitudeDifferenceRad = MAKKAH_LNG_RAD - lng * DEG2RAD;
  const observerLatitudeRad = lat * DEG2RAD;
  const sinLongitudeDifference = Math.sin(longitudeDifferenceRad);
  // cos(φ_obs)·tan(φ_kaaba): the Kaaba's latitude pulls the bearing south in the northern hemisphere
  const cosObserverLatTimesKaabaLatTan =
    Math.cos(observerLatitudeRad) * TAN_MAKKAH_LAT;
  // sin(φ_obs)·cos(ΔL): the observer's latitude adjusts for the curvature of the Earth
  const sinObserverLatTimesCosLngDiff =
    Math.sin(observerLatitudeRad) * Math.cos(longitudeDifferenceRad);
  // atan2 gives the bearing; normalize to [0,360) so north=0, east=90
  return normalizeDeg(
    Math.atan2(
      sinLongitudeDifference,
      cosObserverLatTimesKaabaLatTan - sinObserverLatTimesCosLngDiff,
    ) * RAD2DEG,
  );
}
