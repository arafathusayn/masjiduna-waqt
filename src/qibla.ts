import { normalizeDeg } from "./units.ts";

// ============================================================
// Qibla — great-circle bearing from observer to Kaaba.
// Formula from "Spherical Trigonometry For the use of colleges
// and schools" page 50.
// ============================================================

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
  const dLng = MAKKAH_LNG_RAD - lng * DEG2RAD;
  const latRad = lat * DEG2RAD;
  const term1 = Math.sin(dLng);
  const term2 = Math.cos(latRad) * TAN_MAKKAH_LAT;
  const term3 = Math.sin(latRad) * Math.cos(dLng);
  return normalizeDeg(Math.atan2(term1, term2 - term3) * RAD2DEG);
}
