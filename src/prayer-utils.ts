import type { Prayer, HighLatRule } from "./schema.ts";
import type { PrayerTimesOutput } from "./prayers.ts";

/** Prayer names in chronological order (daytime). */
const PRAYER_ORDER: Prayer[] = [
  "fajr" as Prayer,
  "sunrise" as Prayer,
  "dhuhr" as Prayer,
  "asr" as Prayer,
  "maghrib" as Prayer,
  "isha" as Prayer,
];

/**
 * Get the epoch ms for a given prayer, or null for "none".
 * Returns null if the prayer result is undefined.
 */
export function timeForPrayer(
  times: PrayerTimesOutput,
  prayer: Prayer,
): number | null {
  if (prayer === "none") return null;
  const result = times[prayer as keyof PrayerTimesOutput];
  if (typeof result !== "object" || !("kind" in result)) return null;
  if (result.kind !== "valid") return null;
  return result.ms;
}

/**
 * Determine which prayer is currently active based on the given time.
 * Walks backward from Isha to Fajr; returns "none" if before Fajr.
 */
export function currentPrayer(
  times: PrayerTimesOutput,
  nowMs: number = Date.now(),
): Prayer {
  // Walk backward through prayer order
  for (let i = PRAYER_ORDER.length - 1; i >= 0; i--) {
    const p = PRAYER_ORDER[i]!;
    const t = timeForPrayer(times, p);
    if (t !== null && nowMs >= t) {
      return p;
    }
  }
  return "none" as Prayer;
}

/**
 * Determine the next upcoming prayer based on the given time.
 * Returns "none" if all prayers have passed (after Isha).
 */
export function nextPrayer(
  times: PrayerTimesOutput,
  nowMs: number = Date.now(),
): Prayer {
  for (const prayer of PRAYER_ORDER) {
    const t = timeForPrayer(times, prayer);
    if (t !== null && nowMs < t) {
      return prayer;
    }
  }
  return "none" as Prayer;
}

/**
 * Night portions used by high-latitude rules to bound Fajr/Isha.
 * Returns the fraction of night used to bound Fajr/Isha.
 */
export function nightPortions(
  highLatRule: HighLatRule,
  fajrAngle: number,
  ishaAngle: number,
): { fajr: number; isha: number } {
  switch (highLatRule) {
    case "middle_of_night":
      return { fajr: 1 / 2, isha: 1 / 2 };
    case "seventh_of_night":
      return { fajr: 1 / 7, isha: 1 / 7 };
    case "twilight_angle":
      return { fajr: fajrAngle / 60, isha: ishaAngle / 60 };
    default:
      return { fajr: 0, isha: 0 };
  }
}

/** Returns `seventh_of_night` for latitudes above 48°, `middle_of_night` otherwise. */
export function recommendedHighLatRule(latitude: number): HighLatRule {
  if (latitude > 48) return "seventh_of_night" as HighLatRule;
  return "middle_of_night" as HighLatRule;
}
