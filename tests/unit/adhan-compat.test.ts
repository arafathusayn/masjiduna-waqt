import { test, expect, describe } from "bun:test";
import { computePrayerTimes } from "../../src/prayers.ts";
import {
  MethodProfile,
  NO_ADJUSTMENTS,
  METHOD_ADJUSTMENTS,
  shadowFactor,
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
// Prayer time computation compatibility tests.
// ============================================================

/** Build config with method adjustments merged into adjustments. */
function makeConfig(
  lat: number,
  lng: number,
  date: number,
  methodName: string,
  tz: string,
  madhab = "standard",
  highLatRule = "middle_of_night",
  userAdjustments?: Partial<Record<string, number>>,
) {
  const method = MethodProfile[methodName as keyof typeof MethodProfile];
  const ma = METHOD_ADJUSTMENTS[methodName] ?? {};

  const adj: PrayerAdjustments = {
    fajr: Minutes.assert((Number(ma.fajr) || 0) + (userAdjustments?.fajr ?? 0)),
    sunrise: Minutes.assert(
      (Number(ma.sunrise) || 0) + (userAdjustments?.sunrise ?? 0),
    ),
    dhuhr: Minutes.assert(
      (Number(ma.dhuhr) || 0) + (userAdjustments?.dhuhr ?? 0),
    ),
    asr: Minutes.assert((Number(ma.asr) || 0) + (userAdjustments?.asr ?? 0)),
    maghrib: Minutes.assert(
      (Number(ma.maghrib) || 0) + (userAdjustments?.maghrib ?? 0),
    ),
    isha: Minutes.assert((Number(ma.isha) || 0) + (userAdjustments?.isha ?? 0)),
  };

  return computePrayerTimes({
    latitude: Latitude.assert(lat),
    longitude: Longitude.assert(lng),
    date,
    timezoneId: tz,
    method,
    madhab: Madhab.assert(madhab),
    highLatRule: HighLatRule.assert(highLatRule),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: adj,
    elevation: Meters.assert(0),
  });
}

function fmt(
  times: ReturnType<typeof computePrayerTimes>,
  prayer: string,
  tz: string,
): string {
  const p = times[prayer as keyof typeof times];
  if (typeof p !== "object" || !("kind" in p) || p.kind !== "valid")
    return "UNDEF";
  return formatLocal(p.ms, tz);
}

describe("shadowFactor", () => {
  test("standard returns 1", () => {
    expect(shadowFactor("standard")).toBe(1);
  });
  test("hanafi returns 2", () => {
    expect(shadowFactor("hanafi")).toBe(2);
  });
});

describe("NorthAmerica / Hanafi — Raleigh 2015-07-12", () => {
  const times = makeConfig(
    35.775,
    -78.6336,
    Date.UTC(2015, 6, 12),
    "NorthAmerica",
    "America/New_York",
    "hanafi",
  );

  test("Fajr", () =>
    expect(fmt(times, "fajr", "America/New_York")).toBe("04:42"));
  test("Sunrise", () =>
    expect(fmt(times, "sunrise", "America/New_York")).toBe("06:08"));
  test("Dhuhr", () =>
    expect(fmt(times, "dhuhr", "America/New_York")).toBe("13:21"));
  test("Asr", () =>
    expect(fmt(times, "asr", "America/New_York")).toBe("18:22"));
  test("Maghrib", () =>
    expect(fmt(times, "maghrib", "America/New_York")).toBe("20:32"));
  test("Isha", () =>
    expect(fmt(times, "isha", "America/New_York")).toBe("21:57"));
});

describe("Egyptian — Cairo 2020-01-01", () => {
  const times = makeConfig(
    30.029,
    31.25,
    Date.UTC(2020, 0, 1),
    "Egyptian",
    "Africa/Cairo",
  );

  test("Fajr", () => expect(fmt(times, "fajr", "Africa/Cairo")).toBe("05:18"));
  test("Sunrise", () =>
    expect(fmt(times, "sunrise", "Africa/Cairo")).toBe("06:51"));
  test("Dhuhr", () =>
    expect(fmt(times, "dhuhr", "Africa/Cairo")).toBe("11:59"));
  test("Asr", () => expect(fmt(times, "asr", "Africa/Cairo")).toBe("14:47"));
  test("Maghrib", () =>
    expect(fmt(times, "maghrib", "Africa/Cairo")).toBe("17:06"));
  test("Isha", () => expect(fmt(times, "isha", "Africa/Cairo")).toBe("18:29"));
});

describe("Turkey — Istanbul 2020-04-16", () => {
  const times = makeConfig(
    41.006,
    28.976,
    Date.UTC(2020, 3, 16),
    "Turkey",
    "Europe/Istanbul",
  );

  test("Fajr", () =>
    expect(fmt(times, "fajr", "Europe/Istanbul")).toBe("04:44"));
  test("Sunrise", () =>
    expect(fmt(times, "sunrise", "Europe/Istanbul")).toBe("06:16"));
  test("Dhuhr", () =>
    expect(fmt(times, "dhuhr", "Europe/Istanbul")).toBe("13:09"));
  test("Asr", () => expect(fmt(times, "asr", "Europe/Istanbul")).toBe("16:53"));
  test("Maghrib", () =>
    expect(fmt(times, "maghrib", "Europe/Istanbul")).toBe("19:52"));
  test("Isha", () =>
    expect(fmt(times, "isha", "Europe/Istanbul")).toBe("21:19"));
});

describe("Singapore — Kuala Lumpur 2021-06-14", () => {
  // Note: Singapore method often uses ceiling rounding; our engine uses nearest-minute.
  // Differences of ±1 min on Fajr are expected due to rounding mode.
  const times = makeConfig(
    3.733,
    101.383,
    Date.UTC(2021, 5, 14),
    "Singapore",
    "Asia/Kuala_Lumpur",
  );

  test("Fajr", () =>
    expect(fmt(times, "fajr", "Asia/Kuala_Lumpur")).toBe("05:40"));
  test("Sunrise", () =>
    expect(fmt(times, "sunrise", "Asia/Kuala_Lumpur")).toBe("07:05"));
  test("Dhuhr", () =>
    expect(fmt(times, "dhuhr", "Asia/Kuala_Lumpur")).toBe("13:16"));
  test("Asr", () =>
    expect(fmt(times, "asr", "Asia/Kuala_Lumpur")).toBe("16:42"));
  test("Maghrib", () =>
    expect(fmt(times, "maghrib", "Asia/Kuala_Lumpur")).toBe("19:25"));
  test("Isha", () =>
    expect(fmt(times, "isha", "Asia/Kuala_Lumpur")).toBe("20:41"));
});

describe("MWL / Shafi with user offsets — Raleigh 2015-12-01", () => {
  const base = makeConfig(
    35.775,
    -78.6336,
    Date.UTC(2015, 11, 1),
    "MWL",
    "America/New_York",
  );
  const times = makeConfig(
    35.775,
    -78.6336,
    Date.UTC(2015, 11, 1),
    "MWL",
    "America/New_York",
    "standard",
    "middle_of_night",
    { fajr: 10, sunrise: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 },
  );

  test("all prayers shifted +10 min from base", () => {
    for (const prayer of [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "maghrib",
      "isha",
    ]) {
      const baseTime = parseTime(fmt(base, prayer, "America/New_York"));
      const offsetTime = parseTime(fmt(times, prayer, "America/New_York"));
      const diff = offsetTime - baseTime;
      // Should be +10 min (allow ±1 for rounding)
      expect(Math.abs(diff - 10)).toBeLessThanOrEqual(1);
    }
  });
});

describe("High-latitude adjustments — Edinburgh 2020-06-15", () => {
  const lat = 55.953;
  const lng = -3.188;
  const date = Date.UTC(2020, 5, 15);
  const tz = "Europe/London";

  test("middle_of_night rule", () => {
    const times = makeConfig(
      lat,
      lng,
      date,
      "MWL",
      tz,
      "standard",
      "middle_of_night",
    );
    expect(times.fajr.kind).toBe("valid");
    expect(times.isha.kind).toBe("valid");
  });

  test("seventh_of_night rule", () => {
    const times = makeConfig(
      lat,
      lng,
      date,
      "MWL",
      tz,
      "standard",
      "seventh_of_night",
    );
    expect(times.fajr.kind).toBe("valid");
    expect(times.isha.kind).toBe("valid");
  });

  test("twilight_angle rule", () => {
    const times = makeConfig(
      lat,
      lng,
      date,
      "MWL",
      tz,
      "standard",
      "twilight_angle",
    );
    expect(times.fajr.kind).toBe("valid");
    expect(times.isha.kind).toBe("valid");
  });
});

describe("Leap year dates", () => {
  test("2016-02-29 (leap day)", () => {
    const times = makeConfig(
      35.775,
      -78.6336,
      Date.UTC(2016, 1, 29),
      "NorthAmerica",
      "America/New_York",
    );
    expect(times.fajr.kind).toBe("valid");
    expect(times.dhuhr.kind).toBe("valid");
  });

  test("2015-02-28 (non-leap)", () => {
    const times = makeConfig(
      35.775,
      -78.6336,
      Date.UTC(2015, 1, 28),
      "NorthAmerica",
      "America/New_York",
    );
    expect(times.fajr.kind).toBe("valid");
    expect(times.dhuhr.kind).toBe("valid");
  });
});

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}
