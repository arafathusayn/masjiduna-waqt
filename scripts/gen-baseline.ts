/**
 * Generate baseline fixture: 20 locations × 365 days × 2 madhabs = 14,600 entries.
 * Each entry stores ms timestamps for all 11 timings.
 *
 * Run: bun scripts/gen-baseline.ts
 */
import { computePrayerTimes, clearSolarCache } from "../src/prayers.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../src/config.ts";
import {
  Latitude,
  Longitude,
  Meters,
  Madhab,
  HighLatRule,
  PolarRule,
  MidnightMode,
} from "../src/schema.ts";

const LOCATIONS = [
  { name: "Makkah", lat: 21.4225, lng: 39.8262 },
  { name: "Dhaka", lat: 23.8103, lng: 90.4125 },
  { name: "Istanbul", lat: 41.006, lng: 28.976 },
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "New York", lat: 40.7128, lng: -74.0059 },
  { name: "Tokyo", lat: 35.6895, lng: 139.6917 },
  { name: "Cairo", lat: 30.044, lng: 31.235 },
  { name: "Paris", lat: 48.8566, lng: 2.3522 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
  { name: "Dubai", lat: 25.2048, lng: 55.2708 },
  { name: "Karachi", lat: 24.8607, lng: 67.0011 },
  { name: "Jakarta", lat: -6.2088, lng: 106.8456 },
  { name: "Lagos", lat: 6.5244, lng: 3.3792 },
  { name: "Berlin", lat: 52.52, lng: 13.405 },
  { name: "Moscow", lat: 55.7558, lng: 37.6173 },
  { name: "Singapore", lat: 1.3521, lng: 103.8198 },
  { name: "Islamabad", lat: 33.7294, lng: 73.0931 },
  { name: "Kuala Lumpur", lat: 3.139, lng: 101.6869 },
  { name: "Riyadh", lat: 24.7136, lng: 46.6753 },
  { name: "Oslo", lat: 59.9139, lng: 10.7522 },
] as const;

const MADHABS = [
  { name: "standard", val: Madhab.assert("standard") },
  { name: "hanafi", val: Madhab.assert("hanafi") },
] as const;

const YEAR = 2025;
const MID_NIGHT = HighLatRule.assert("middle_of_night");
const UNRESOLVED = PolarRule.assert("unresolved");
const STANDARD = MidnightMode.assert("standard");
const ZERO_ELEV = Meters.assert(0);

function ms(r: { kind: string; ms?: number }): number | null {
  return r.kind === "valid" ? (r as { ms: number }).ms : null;
}

type Entry = {
  loc: string;
  day: number;
  madhab: string;
  fajr: number | null;
  sunrise: number | null;
  dhuhr: number | null;
  asr: number | null;
  sunset: number | null;
  maghrib: number | null;
  isha: number | null;
  midnight: number | null;
  imsak: number | null;
  firstThird: number | null;
  lastThird: number | null;
};

const entries: Entry[] = [];

clearSolarCache();

for (const loc of LOCATIONS) {
  const lat = Latitude.assert(loc.lat);
  const lng = Longitude.assert(loc.lng);

  for (const madhab of MADHABS) {
    for (let d = 0; d < 365; d++) {
      const date = Date.UTC(YEAR, 0, 1 + d);
      const result = computePrayerTimes({
        latitude: lat,
        longitude: lng,
        date,
        timezoneId: "UTC",
        method: MethodProfile.MWL,
        madhab: madhab.val,
        highLatRule: MID_NIGHT,
        polarRule: UNRESOLVED,
        midnightMode: STANDARD,
        adjustments: NO_ADJUSTMENTS,
        elevation: ZERO_ELEV,
      });

      entries.push({
        loc: loc.name,
        day: d,
        madhab: madhab.name,
        fajr: ms(result.fajr),
        sunrise: ms(result.sunrise),
        dhuhr: ms(result.dhuhr),
        asr: ms(result.asr),
        sunset: ms(result.sunset),
        maghrib: ms(result.maghrib),
        isha: ms(result.isha),
        midnight: ms(result.midnight),
        imsak: ms(result.imsak),
        firstThird: ms(result.firstThird),
        lastThird: ms(result.lastThird),
      });
    }
  }
}

const outPath = new URL(
  "../tests/fixtures/prayers-baseline-20x365.json",
  import.meta.url,
).pathname;
await Bun.write(outPath, JSON.stringify(entries));
console.log(`Wrote ${entries.length} entries to ${outPath}`);
