import type { Shafaq } from "./schema.ts";
import { daysSinceSolstice } from "./date-utils.ts";

function seasonalAdjustment(
  dyy: number,
  a: number,
  b: number,
  c: number,
  d: number,
): number {
  if (dyy < 91) {
    return a + ((b - a) / 91) * dyy;
  } else if (dyy < 137) {
    return b + ((c - b) / 46) * (dyy - 91);
  } else if (dyy < 183) {
    return c + ((d - c) / 46) * (dyy - 137);
  } else if (dyy < 229) {
    return d + ((c - d) / 46) * (dyy - 183);
  } else if (dyy < 275) {
    return c + ((b - c) / 46) * (dyy - 229);
  } else {
    return b + ((a - b) / 91) * (dyy - 275);
  }
}

/**
 * Season-adjusted morning twilight (Fajr bound) for MoonsightingCommittee.
 * Returns epoch ms that is `adjustment` minutes before sunrise.
 */
export function seasonAdjustedMorningTwilight(
  lat: number,
  doy: number,
  year: number,
  sunriseMs: number,
): number {
  const absLat = Math.abs(lat);
  const a = 75 + (28.65 / 55) * absLat;
  const b = 75 + (19.44 / 55) * absLat;
  const c = 75 + (32.74 / 55) * absLat;
  const d = 75 + (48.1 / 55) * absLat;

  const dyy = daysSinceSolstice(doy, year, lat);
  const adjustment = seasonalAdjustment(dyy, a, b, c, d);

  return sunriseMs + Math.round(adjustment * -60) * 1000;
}

/**
 * Season-adjusted evening twilight (Isha bound) for MoonsightingCommittee.
 * Returns epoch ms that is `adjustment` minutes after sunset.
 * Shafaq variant controls the coefficient tables.
 */
export function seasonAdjustedEveningTwilight(
  lat: number,
  doy: number,
  year: number,
  sunsetMs: number,
  shafaq: Shafaq = "general" as Shafaq,
): number {
  const absLat = Math.abs(lat);
  let a: number, b: number, c: number, d: number;

  if (shafaq === "ahmer") {
    a = 62 + (17.4 / 55) * absLat;
    b = 62 - (7.16 / 55) * absLat;
    c = 62 + (5.12 / 55) * absLat;
    d = 62 + (19.44 / 55) * absLat;
  } else if (shafaq === "abyad") {
    a = 75 + (25.6 / 55) * absLat;
    b = 75 + (7.16 / 55) * absLat;
    c = 75 + (36.84 / 55) * absLat;
    d = 75 + (81.84 / 55) * absLat;
  } else {
    // general (default)
    a = 75 + (25.6 / 55) * absLat;
    b = 75 + (2.05 / 55) * absLat;
    c = 75 - (9.21 / 55) * absLat;
    d = 75 + (6.14 / 55) * absLat;
  }

  const dyy = daysSinceSolstice(doy, year, lat);
  const adjustment = seasonalAdjustment(dyy, a, b, c, d);

  return sunsetMs + Math.round(adjustment * 60) * 1000;
}
