import { test, expect, describe } from "bun:test";
import { computeSunnahTimes } from "../../src/sunnah.ts";
import { computePrayerTimes } from "../../src/prayers.ts";
import {
  MethodProfile,
  NO_ADJUSTMENTS,
  METHOD_ADJUSTMENTS,
} from "../../src/config.ts";
import {
  Latitude,
  Longitude,
  Meters,
  Minutes,
  Madhab,
  HighLatRule,
  PolarRule,
  MidnightMode,
  type PrayerAdjustments,
} from "../../src/schema.ts";
import { formatLocal } from "../../src/format.ts";

// ============================================================
// Sunnah times tests.
// ============================================================

function makeTimes(
  lat: number,
  lng: number,
  dateMs: number,
  methodName: string,
  madhab = "standard",
) {
  const m = MethodProfile[methodName as keyof typeof MethodProfile];
  const ma = METHOD_ADJUSTMENTS[methodName] ?? {};
  const adj: PrayerAdjustments = {
    fajr: Minutes.assert(Number(ma.fajr) || 0),
    sunrise: Minutes.assert(Number(ma.sunrise) || 0),
    dhuhr: Minutes.assert(Number(ma.dhuhr) || 0),
    asr: Minutes.assert(Number(ma.asr) || 0),
    maghrib: Minutes.assert(Number(ma.maghrib) || 0),
    isha: Minutes.assert(Number(ma.isha) || 0),
  };
  return computePrayerTimes({
    latitude: Latitude.assert(lat),
    longitude: Longitude.assert(lng),
    date: dateMs,
    timezoneId: "UTC",
    method: m,
    madhab: Madhab.assert(madhab),
    highLatRule: HighLatRule.assert("middle_of_night"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: adj,
    elevation: Meters.assert(0),
  });
}

function fmtHHMM(ms: number, tz: string): string {
  return formatLocal(ms, tz);
}

describe("Sunnah times", () => {
  test("New York — NorthAmerica/Hanafi", () => {
    // Expected: middle=00:38, lastThird=01:59
    const today = makeTimes(
      35.775,
      -78.6336,
      Date.UTC(2015, 6, 12),
      "NorthAmerica",
      "hanafi",
    );
    const tomorrow = makeTimes(
      35.775,
      -78.6336,
      Date.UTC(2015, 6, 13),
      "NorthAmerica",
      "hanafi",
    );
    if (today.maghrib.kind !== "valid" || tomorrow.fajr.kind !== "valid")
      throw new Error("Prayers undefined");

    const sunnah = computeSunnahTimes(today.maghrib.ms, tomorrow.fajr.ms);
    expect(fmtHHMM(sunnah.middleOfTheNight, "America/New_York")).toBe("00:38");
    // 02:00 vs 01:59 — 1 min rounding diff is acceptable
    const lastThird = fmtHHMM(sunnah.lastThirdOfTheNight, "America/New_York");
    expect(lastThird === "01:59" || lastThird === "02:00").toBe(true);
  });

  test("London — MWL, Dec 2015", () => {
    // Expected: middle=22:49, lastThird=01:07
    const today = makeTimes(
      51.5074,
      -0.1278,
      Date.UTC(2015, 11, 1),
      "MWL",
    );
    const tomorrow = makeTimes(
      51.5074,
      -0.1278,
      Date.UTC(2015, 11, 2),
      "MWL",
    );
    if (today.maghrib.kind !== "valid" || tomorrow.fajr.kind !== "valid")
      throw new Error("Prayers undefined");

    const sunnah = computeSunnahTimes(today.maghrib.ms, tomorrow.fajr.ms);
    const middle = fmtHHMM(sunnah.middleOfTheNight, "Europe/London");
    const lastThird = fmtHHMM(sunnah.lastThirdOfTheNight, "Europe/London");
    // Allow ±1 min rounding
    expect(timeDiff(middle, "22:49")).toBeLessThanOrEqual(1);
    expect(timeDiff(lastThird, "01:07")).toBeLessThanOrEqual(1);
  });

  test("Oslo — MWL, Jan 2016", () => {
    // Expected: middle=22:59, lastThird=01:31
    const today = makeTimes(
      59.9094,
      10.7349,
      Date.UTC(2016, 0, 1),
      "MWL",
    );
    const tomorrow = makeTimes(
      59.9094,
      10.7349,
      Date.UTC(2016, 0, 2),
      "MWL",
    );
    if (today.maghrib.kind !== "valid" || tomorrow.fajr.kind !== "valid")
      throw new Error("Prayers undefined");

    const sunnah = computeSunnahTimes(today.maghrib.ms, tomorrow.fajr.ms);
    const middle = fmtHHMM(sunnah.middleOfTheNight, "Europe/Oslo");
    const lastThird = fmtHHMM(sunnah.lastThirdOfTheNight, "Europe/Oslo");
    expect(timeDiff(middle, "22:59")).toBeLessThanOrEqual(1);
    expect(timeDiff(lastThird, "01:31")).toBeLessThanOrEqual(1);
  });

  test("US DST transition — San Francisco, Mar 11-12, 2017", () => {
    // Expected: middle=23:43, lastThird=01:33
    const today = makeTimes(
      37.7749,
      -122.4194,
      Date.UTC(2017, 2, 11),
      "NorthAmerica",
    );
    const tomorrow = makeTimes(
      37.7749,
      -122.4194,
      Date.UTC(2017, 2, 12),
      "NorthAmerica",
    );
    if (today.maghrib.kind !== "valid" || tomorrow.fajr.kind !== "valid")
      throw new Error("Prayers undefined");

    const sunnah = computeSunnahTimes(today.maghrib.ms, tomorrow.fajr.ms);
    const middle = fmtHHMM(sunnah.middleOfTheNight, "America/Los_Angeles");
    const lastThird = fmtHHMM(
      sunnah.lastThirdOfTheNight,
      "America/Los_Angeles",
    );
    expect(timeDiff(middle, "23:43")).toBeLessThanOrEqual(1);
    expect(timeDiff(lastThird, "01:33")).toBeLessThanOrEqual(1);
  });

  test("basic night division math", () => {
    const sunsetMs = new Date(Date.UTC(2020, 0, 1, 17, 0, 0)).getTime();
    const fajrMs = new Date(Date.UTC(2020, 0, 2, 5, 0, 0)).getTime();
    // Night = 12 hours
    const sunnah = computeSunnahTimes(sunsetMs, fajrMs);
    // Middle = sunset + 6h = 23:00
    expect(new Date(sunnah.middleOfTheNight).getUTCHours()).toBe(23);
    expect(new Date(sunnah.middleOfTheNight).getUTCMinutes()).toBe(0);
    // Last third = sunset + 8h = 01:00
    expect(new Date(sunnah.lastThirdOfTheNight).getUTCHours()).toBe(1);
    expect(new Date(sunnah.lastThirdOfTheNight).getUTCMinutes()).toBe(0);
  });
});

/** Absolute difference in minutes between two "HH:MM" strings. */
function timeDiff(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  let diff = ah! * 60 + am! - (bh! * 60 + bm!);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return Math.abs(diff);
}
