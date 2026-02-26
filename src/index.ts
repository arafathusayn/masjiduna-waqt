// --- Schema: validators + branded types + enums ---
export * from "./schema.ts";

// --- Trig helpers ---
export {
  sinDeg,
  cosDeg,
  tanDeg,
  asinDeg,
  acosDeg,
  atanDeg,
  atan2Deg,
  normalizeDeg,
} from "./units.ts";

// --- Config ---
export {
  MethodProfile,
  NO_ADJUSTMENTS,
  METHOD_ADJUSTMENTS,
  shadowFactor,
} from "./config.ts";

// --- Solar ---
export {
  toJulianDate,
  toJulianCentury,
  solarPosition,
  meanSolarLongitude,
  meanSolarAnomaly,
  solarEquationOfTheCenter,
  apparentSolarLongitude,
  meanObliquityOfTheEcliptic,
  apparentObliquityOfTheEcliptic,
  meanLunarLongitude,
  ascendingLunarNodeLongitude,
  nutationInLongitude,
  nutationInObliquity,
  meanSiderealTime,
} from "./solar.ts";
export type { SolarPosition } from "./solar.ts";

// --- Hour angle ---
export {
  computeHourAngle,
  hourAngleToHours,
  normalizeToScale,
  altitudeOfCelestialBody,
  approximateTransit,
  correctedTransit,
  correctedHourAngle,
  interpolate,
  interpolateAngles,
  quadrantShiftAngle,
} from "./hour-angle.ts";
export type { HourAngleResult } from "./hour-angle.ts";

// --- Prayer computation ---
export {
  computePrayerTimes,
  createPrayerContext,
  clearSolarCache,
} from "./prayers.ts";
export type {
  PrayerTimeInput,
  MethodInput,
  AdjustmentsInput,
  PrayerDiagnostics,
  PrayerTimeResult,
  PrayerTimesOutput,
  PrayerContextConfig,
  PrayerContext,
} from "./prayers.ts";

// --- High latitude ---
export { applyHighLatFallback } from "./high-latitude.ts";

// --- Formatting ---
export { formatLocal } from "./format.ts";

// --- Date utilities ---
export {
  isLeapYear,
  dayOfYear,
  dateByAddingDays,
  dateByAddingMinutes,
  dateByAddingSeconds,
  roundedMinute,
  decomposeHours,
  daysSinceSolstice,
} from "./date-utils.ts";

// --- Qibla ---
export { computeQibla } from "./qibla.ts";

// --- Prayer utilities ---
export {
  timeForPrayer,
  currentPrayer,
  nextPrayer,
  nightPortions,
  recommendedHighLatRule,
} from "./prayer-utils.ts";

// --- Sunnah times ---
export { computeSunnahTimes } from "./sunnah.ts";
export type { SunnahTimesResult } from "./sunnah.ts";

// --- Moonsighting Committee ---
export {
  seasonAdjustedMorningTwilight,
  seasonAdjustedEveningTwilight,
} from "./moonsighting.ts";
