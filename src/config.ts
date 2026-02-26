import type { MethodAngles, PrayerAdjustments } from "./schema.ts";

export function shadowFactor(m: "standard" | "hanafi"): 1 | 2 {
  return m === "standard" ? 1 : 2;
}

export const MethodProfile = {
  Karachi: { fajr: 18, isha: 18, ishaInterval: null, maghribAngle: null },
  Turkey: { fajr: 18, isha: 17, ishaInterval: null, maghribAngle: null },
  MWL: { fajr: 18, isha: 17, ishaInterval: null, maghribAngle: null },
  ISNA: { fajr: 15, isha: 15, ishaInterval: null, maghribAngle: null },
  Egyptian: { fajr: 19.5, isha: 17.5, ishaInterval: null, maghribAngle: null },
  UmmAlQura: { fajr: 18.5, isha: 0, ishaInterval: 90, maghribAngle: null },
  Singapore: { fajr: 20, isha: 18, ishaInterval: null, maghribAngle: null },
  Dubai: { fajr: 18.2, isha: 18.2, ishaInterval: null, maghribAngle: null },
  Kuwait: { fajr: 18, isha: 17.5, ishaInterval: null, maghribAngle: null },
  Qatar: { fajr: 18, isha: 0, ishaInterval: 90, maghribAngle: null },
  MoonsightingCommittee: {
    fajr: 18,
    isha: 18,
    ishaInterval: null,
    maghribAngle: null,
  },
  NorthAmerica: { fajr: 15, isha: 15, ishaInterval: null, maghribAngle: null },
  Other: { fajr: 0, isha: 0, ishaInterval: null, maghribAngle: null },
} satisfies Record<string, MethodAngles>;

export const NO_ADJUSTMENTS: PrayerAdjustments = {
  fajr: 0,
  sunrise: 0,
  dhuhr: 0,
  asr: 0,
  maghrib: 0,
  isha: 0,
};

export const METHOD_ADJUSTMENTS: Record<string, Partial<PrayerAdjustments>> = {
  MWL: { dhuhr: 1 },
  Egyptian: { dhuhr: 1 },
  Karachi: { dhuhr: 1 },
  NorthAmerica: { dhuhr: 1 },
  Singapore: { dhuhr: 1 },
  Dubai: { sunrise: -3, dhuhr: 3, asr: 3, maghrib: 3 },
  MoonsightingCommittee: { dhuhr: 5, maghrib: 3 },
  Turkey: { sunrise: -7, dhuhr: 5, asr: 4, maghrib: 7 },
};
