import {
  Madhab,
  type Madhab as MadhabType,
  type MethodAngles,
} from "../../src/schema.ts";
import { MethodProfile } from "../../src/config.ts";

// ============================================================
// Shared E2E configuration — used by fetch-fixtures + tests
// ============================================================

export interface TestLocation {
  name: string;
  lat: number;
  lng: number;
  tz: string;
  madhab: MadhabType;
  aladhanSchool: number;
  expectedSchoolStr: string;
  /** Override tolerance for high-lat cities */
  toleranceMinutes?: number;
}

export const LOCATIONS: ReadonlyArray<TestLocation> = [
  {
    name: "Mecca",
    lat: 21.4225,
    lng: 39.8262,
    tz: "Asia/Riyadh",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  // --- Bangladesh: all 8 divisions, both Hanafi and Standard ---
  {
    name: "Chittagong (Hanafi)",
    lat: 22.3569,
    lng: 91.7832,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Chittagong (Standard)",
    lat: 22.3569,
    lng: 91.7832,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Dhaka (Hanafi)",
    lat: 23.8103,
    lng: 90.4125,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Dhaka (Standard)",
    lat: 23.8103,
    lng: 90.4125,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Khulna (Hanafi)",
    lat: 22.8456,
    lng: 89.5403,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Khulna (Standard)",
    lat: 22.8456,
    lng: 89.5403,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Rajshahi (Hanafi)",
    lat: 24.3745,
    lng: 88.6042,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Rajshahi (Standard)",
    lat: 24.3745,
    lng: 88.6042,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Barishal (Hanafi)",
    lat: 22.701,
    lng: 90.3535,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Barishal (Standard)",
    lat: 22.701,
    lng: 90.3535,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Sylhet (Hanafi)",
    lat: 24.8949,
    lng: 91.8687,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Sylhet (Standard)",
    lat: 24.8949,
    lng: 91.8687,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Rangpur (Hanafi)",
    lat: 25.7439,
    lng: 89.2752,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Rangpur (Standard)",
    lat: 25.7439,
    lng: 89.2752,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Mymensingh (Hanafi)",
    lat: 24.7471,
    lng: 90.4203,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Mymensingh (Standard)",
    lat: 24.7471,
    lng: 90.4203,
    tz: "Asia/Dhaka",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Jakarta",
    lat: -6.2088,
    lng: 106.8456,
    tz: "Asia/Jakarta",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "Cairo",
    lat: 30.0444,
    lng: 31.2357,
    tz: "Africa/Cairo",
    madhab: Madhab.assert("standard"),
    aladhanSchool: 0,
    expectedSchoolStr: "STANDARD",
  },
  {
    name: "New York",
    lat: 40.7128,
    lng: -74.006,
    tz: "America/New_York",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "London",
    lat: 51.5074,
    lng: -0.1278,
    tz: "Europe/London",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
  {
    name: "Sydney",
    lat: -33.8688,
    lng: 151.2093,
    tz: "Australia/Sydney",
    madhab: Madhab.assert("hanafi"),
    aladhanSchool: 1,
    expectedSchoolStr: "HANAFI",
  },
];

export interface TestMethod {
  name: string;
  aladhanId: number;
  angles: MethodAngles;
}

export const METHODS: ReadonlyArray<TestMethod> = [
  { name: "Karachi", aladhanId: 1, angles: MethodProfile.Karachi },
  { name: "ISNA", aladhanId: 2, angles: MethodProfile.ISNA },
  { name: "MWL", aladhanId: 3, angles: MethodProfile.MWL },
  { name: "Egyptian", aladhanId: 5, angles: MethodProfile.Egyptian },
  { name: "Singapore", aladhanId: 11, angles: MethodProfile.Singapore },
];

/**
 * Fixed dates covering astronomical edges + 48 samples per year for 2026-2027.
 * Each year has 4 dates per month (one per week) × 12 months = 48 dates.
 * Format: DD-MM-YYYY (Aladhan API date format)
 */
export const DATES: ReadonlyArray<string> = [
  // --- Astronomical edge cases (14) ---
  "21-06-2025", // summer solstice
  "21-12-2025", // winter solstice
  "20-03-2025", // vernal equinox
  "22-09-2025", // autumnal equinox
  "29-02-2024", // leap day
  "01-01-2025", // deep winter NH
  "15-04-2024", // spring
  "10-08-2023", // peak summer
  "05-11-2022", // autumn
  "14-07-2024", // mid-summer
  "03-03-2023", // late winter
  "28-10-2025", // DST transition zone
  "17-06-2024", // near solstice
  "25-12-2023", // deep winter

  // --- 2026: 4 dates per month × 12 months = 48 ---
  "03-01-2026",
  "10-01-2026",
  "18-01-2026",
  "27-01-2026", // Jan
  "02-02-2026",
  "11-02-2026",
  "17-02-2026",
  "24-02-2026", // Feb
  "05-03-2026",
  "12-03-2026",
  "19-03-2026",
  "26-03-2026", // Mar
  "01-04-2026",
  "09-04-2026",
  "16-04-2026",
  "23-04-2026", // Apr
  "04-05-2026",
  "13-05-2026",
  "20-05-2026",
  "28-05-2026", // May
  "02-06-2026",
  "11-06-2026",
  "18-06-2026",
  "25-06-2026", // Jun
  "06-07-2026",
  "14-07-2026",
  "22-07-2026",
  "29-07-2026", // Jul
  "03-08-2026",
  "10-08-2026",
  "17-08-2026",
  "24-08-2026", // Aug
  "01-09-2026",
  "09-09-2026",
  "16-09-2026",
  "25-09-2026", // Sep
  "05-10-2026",
  "13-10-2026",
  "20-10-2026",
  "27-10-2026", // Oct
  "02-11-2026",
  "11-11-2026",
  "19-11-2026",
  "26-11-2026", // Nov
  "07-12-2026",
  "14-12-2026",
  "21-12-2026",
  "28-12-2026", // Dec

  // --- 2027: 4 dates per month × 12 months = 48 ---
  "04-01-2027",
  "11-01-2027",
  "19-01-2027",
  "26-01-2027", // Jan
  "01-02-2027",
  "08-02-2027",
  "15-02-2027",
  "22-02-2027", // Feb
  "03-03-2027",
  "12-03-2027",
  "18-03-2027",
  "25-03-2027", // Mar
  "05-04-2027",
  "13-04-2027",
  "20-04-2027",
  "27-04-2027", // Apr
  "03-05-2027",
  "10-05-2027",
  "17-05-2027",
  "24-05-2027", // May
  "07-06-2027",
  "14-06-2027",
  "21-06-2027",
  "28-06-2027", // Jun
  "05-07-2027",
  "12-07-2027",
  "19-07-2027",
  "26-07-2027", // Jul
  "02-08-2027",
  "09-08-2027",
  "16-08-2027",
  "30-08-2027", // Aug
  "06-09-2027",
  "13-09-2027",
  "20-09-2027",
  "27-09-2027", // Sep
  "04-10-2027",
  "11-10-2027",
  "18-10-2027",
  "25-10-2027", // Oct
  "01-11-2027",
  "08-11-2027",
  "15-11-2027",
  "29-11-2027", // Nov
  "06-12-2027",
  "13-12-2027",
  "20-12-2027",
  "27-12-2027", // Dec
];

export const PRAYERS_TO_COMPARE = [
  "Fajr",
  "Sunrise",
  "Dhuhr",
  "Asr",
  "Sunset",
  "Maghrib",
  "Isha",
  "Midnight",
  "Imsak",
  "Firstthird",
  "Lastthird",
] as const;

export function parseAladhanDate(s: string): number {
  const [dd, mm, yyyy] = s.split("-").map(Number);
  return Date.UTC(yyyy!, mm! - 1, dd);
}

export function cleanTime(s: string): string {
  return s.replace(/\s*\(.*\)$/, "");
}
