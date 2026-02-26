import type { Shafaq } from "./schema.ts";
import { daysSinceSolstice } from "./date-utils.ts";

function seasonalAdjustment(
  daysSinceSolsticeN: number,
  segmentValueA: number,
  segmentValueB: number,
  segmentValueC: number,
  segmentValueD: number,
): number {
  if (daysSinceSolsticeN < 91) {
    return (
      segmentValueA +
      ((segmentValueB - segmentValueA) / 91) * daysSinceSolsticeN
    );
  } else if (daysSinceSolsticeN < 137) {
    return (
      segmentValueB +
      ((segmentValueC - segmentValueB) / 46) * (daysSinceSolsticeN - 91)
    );
  } else if (daysSinceSolsticeN < 183) {
    return (
      segmentValueC +
      ((segmentValueD - segmentValueC) / 46) * (daysSinceSolsticeN - 137)
    );
  } else if (daysSinceSolsticeN < 229) {
    return (
      segmentValueD +
      ((segmentValueC - segmentValueD) / 46) * (daysSinceSolsticeN - 183)
    );
  } else if (daysSinceSolsticeN < 275) {
    return (
      segmentValueC +
      ((segmentValueB - segmentValueC) / 46) * (daysSinceSolsticeN - 229)
    );
  } else {
    return (
      segmentValueB +
      ((segmentValueA - segmentValueB) / 91) * (daysSinceSolsticeN - 275)
    );
  }
}

/**
 * Season-adjusted morning twilight (Fajr bound) for MoonsightingCommittee.
 * Returns epoch ms that is `minutesBeforeSunrise` minutes before sunrise.
 */
export function seasonAdjustedMorningTwilight(
  lat: number,
  doy: number,
  year: number,
  sunriseMs: number,
): number {
  const absoluteLatitudeDeg = Math.abs(lat);
  // Coefficients are empirically determined latitude-scaling factors for the piecewise seasonal curve
  const segmentValueA = 75 + (28.65 / 55) * absoluteLatitudeDeg;
  const segmentValueB = 75 + (19.44 / 55) * absoluteLatitudeDeg;
  const segmentValueC = 75 + (32.74 / 55) * absoluteLatitudeDeg;
  const segmentValueD = 75 + (48.1 / 55) * absoluteLatitudeDeg;

  // Seasonal position determines which twilight segment applies; the solstice is the reference point
  const daysSinceSolsticeN = daysSinceSolstice(doy, year, lat);
  const minutesBeforeSunrise = seasonalAdjustment(
    daysSinceSolsticeN,
    segmentValueA,
    segmentValueB,
    segmentValueC,
    segmentValueD,
  );

  // Fajr is before sunrise, so subtract the adjustment (converted from minutes to milliseconds)
  return sunriseMs + Math.round(minutesBeforeSunrise * -60) * 1000;
}

/**
 * Season-adjusted evening twilight (Isha bound) for MoonsightingCommittee.
 * Returns epoch ms that is `minutesAfterSunset` minutes after sunset.
 * Shafaq variant controls the coefficient tables.
 */
export function seasonAdjustedEveningTwilight(
  lat: number,
  doy: number,
  year: number,
  sunsetMs: number,
  shafaq: Shafaq = "general" as Shafaq,
): number {
  const absoluteLatitudeDeg = Math.abs(lat);
  // Coefficients are empirically determined latitude-scaling factors for the piecewise seasonal curve
  let segmentValueA: number,
    segmentValueB: number,
    segmentValueC: number,
    segmentValueD: number;

  if (shafaq === "ahmer") {
    segmentValueA = 62 + (17.4 / 55) * absoluteLatitudeDeg;
    segmentValueB = 62 - (7.16 / 55) * absoluteLatitudeDeg;
    segmentValueC = 62 + (5.12 / 55) * absoluteLatitudeDeg;
    segmentValueD = 62 + (19.44 / 55) * absoluteLatitudeDeg;
  } else if (shafaq === "abyad") {
    segmentValueA = 75 + (25.6 / 55) * absoluteLatitudeDeg;
    segmentValueB = 75 + (7.16 / 55) * absoluteLatitudeDeg;
    segmentValueC = 75 + (36.84 / 55) * absoluteLatitudeDeg;
    segmentValueD = 75 + (81.84 / 55) * absoluteLatitudeDeg;
  } else {
    // general (default)
    segmentValueA = 75 + (25.6 / 55) * absoluteLatitudeDeg;
    segmentValueB = 75 + (2.05 / 55) * absoluteLatitudeDeg;
    segmentValueC = 75 - (9.21 / 55) * absoluteLatitudeDeg;
    segmentValueD = 75 + (6.14 / 55) * absoluteLatitudeDeg;
  }

  // Seasonal position determines which twilight segment applies; the solstice is the reference point
  const daysSinceSolsticeN = daysSinceSolstice(doy, year, lat);
  const minutesAfterSunset = seasonalAdjustment(
    daysSinceSolsticeN,
    segmentValueA,
    segmentValueB,
    segmentValueC,
    segmentValueD,
  );

  return sunsetMs + Math.round(minutesAfterSunset * 60) * 1000;
}
