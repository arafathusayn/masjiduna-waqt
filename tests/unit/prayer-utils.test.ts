import { test, expect, describe } from "bun:test";
import {
  timeForPrayer,
  currentPrayer,
  nextPrayer,
  nightPortions,
  recommendedHighLatRule,
} from "../../src/prayer-utils.ts";
import { computePrayerTimes } from "../../src/prayers.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../../src/config.ts";
import {
  Latitude,
  Longitude,
  Meters,
  Madhab,
  HighLatRule,
  PolarRule,
  MidnightMode,
  type Prayer,
} from "../../src/schema.ts";

// ============================================================
// Prayer utility tests
// ============================================================

function makeTimes(
  lat: number,
  lng: number,
  dateMs: number,
  method: string,
  madhab = "hanafi",
) {
  const m = MethodProfile[method as keyof typeof MethodProfile];
  return computePrayerTimes({
    latitude: Latitude.assert(lat),
    longitude: Longitude.assert(lng),
    date: dateMs,
    timezoneId: "Asia/Karachi",
    method: m,
    madhab: Madhab.assert(madhab),
    highLatRule: HighLatRule.assert("middle_of_night"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  });
}

// Helper to compare branded return values with plain strings
const eq = (actual: unknown, expected: string) =>
  expect(String(actual)).toBe(expected);

describe("timeForPrayer", () => {
  const times = makeTimes(
    33.7294,
    73.0931,
    Date.UTC(2015, 8, 1),
    "Karachi",
  );

  test("returns number for each prayer", () => {
    const prayers = [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "maghrib",
      "isha",
    ] as Prayer[];
    for (const p of prayers) {
      const t = timeForPrayer(times, p);
      expect(typeof t).toBe("number");
    }
  });

  test("returns null for 'none'", () => {
    expect(timeForPrayer(times, "none" as Prayer)).toBeNull();
  });
});

describe("currentPrayer", () => {
  const times = makeTimes(
    33.7294,
    73.0931,
    Date.UTC(2015, 8, 1),
    "Karachi",
  );

  test("before fajr → none", () => {
    const fajr = timeForPrayer(times, "fajr" as Prayer)!;
    const before = fajr - 60_000;
    eq(currentPrayer(times, before), "none");
  });

  test("at fajr → fajr", () => {
    const fajr = timeForPrayer(times, "fajr" as Prayer)!;
    eq(currentPrayer(times, fajr), "fajr");
  });

  test("at sunrise → sunrise", () => {
    const sunrise = timeForPrayer(times, "sunrise" as Prayer)!;
    eq(currentPrayer(times, sunrise), "sunrise");
  });

  test("at dhuhr → dhuhr", () => {
    const dhuhr = timeForPrayer(times, "dhuhr" as Prayer)!;
    eq(currentPrayer(times, dhuhr), "dhuhr");
  });

  test("at asr → asr", () => {
    const asr = timeForPrayer(times, "asr" as Prayer)!;
    eq(currentPrayer(times, asr), "asr");
  });

  test("at maghrib → maghrib", () => {
    const maghrib = timeForPrayer(times, "maghrib" as Prayer)!;
    eq(currentPrayer(times, maghrib), "maghrib");
  });

  test("at isha → isha", () => {
    const isha = timeForPrayer(times, "isha" as Prayer)!;
    eq(currentPrayer(times, isha), "isha");
  });
});

describe("nextPrayer", () => {
  const times = makeTimes(
    33.7294,
    73.0931,
    Date.UTC(2015, 8, 1),
    "Karachi",
  );

  test("before fajr → fajr", () => {
    const fajr = timeForPrayer(times, "fajr" as Prayer)!;
    const before = fajr - 60_000;
    eq(nextPrayer(times, before), "fajr");
  });

  test("at fajr → sunrise", () => {
    const fajr = timeForPrayer(times, "fajr" as Prayer)!;
    eq(nextPrayer(times, fajr), "sunrise");
  });

  test("at sunrise → dhuhr", () => {
    const sunrise = timeForPrayer(times, "sunrise" as Prayer)!;
    eq(nextPrayer(times, sunrise), "dhuhr");
  });

  test("at dhuhr → asr", () => {
    const dhuhr = timeForPrayer(times, "dhuhr" as Prayer)!;
    eq(nextPrayer(times, dhuhr), "asr");
  });

  test("at asr → maghrib", () => {
    const asr = timeForPrayer(times, "asr" as Prayer)!;
    eq(nextPrayer(times, asr), "maghrib");
  });

  test("at maghrib → isha", () => {
    const maghrib = timeForPrayer(times, "maghrib" as Prayer)!;
    eq(nextPrayer(times, maghrib), "isha");
  });

  test("at isha → none", () => {
    const isha = timeForPrayer(times, "isha" as Prayer)!;
    eq(nextPrayer(times, isha), "none");
  });
});

describe("nightPortions", () => {
  test("middle_of_night", () => {
    const np = nightPortions("middle_of_night" as HighLatRule, 18, 18);
    expect(np.fajr).toBeCloseTo(1 / 2, 10);
    expect(np.isha).toBeCloseTo(1 / 2, 10);
  });

  test("seventh_of_night", () => {
    const np = nightPortions("seventh_of_night" as HighLatRule, 18, 18);
    expect(np.fajr).toBeCloseTo(1 / 7, 10);
    expect(np.isha).toBeCloseTo(1 / 7, 10);
  });

  test("twilight_angle", () => {
    const np = nightPortions("twilight_angle" as HighLatRule, 18, 17);
    expect(np.fajr).toBeCloseTo(18 / 60, 10);
    expect(np.isha).toBeCloseTo(17 / 60, 10);
  });
});

describe("recommendedHighLatRule", () => {
  test("lat < 48 → middle_of_night", () => {
    eq(recommendedHighLatRule(45), "middle_of_night");
  });

  test("lat = 48 → middle_of_night", () => {
    eq(recommendedHighLatRule(48), "middle_of_night");
  });

  test("lat > 48 → seventh_of_night", () => {
    eq(recommendedHighLatRule(48.1), "seventh_of_night");
  });

  test("lat = 55 → seventh_of_night", () => {
    eq(recommendedHighLatRule(55), "seventh_of_night");
  });
});

describe("Method angle verification", () => {
  test("all methods have correct fajr/isha values", () => {
    expect(Number(MethodProfile.MWL.fajr)).toBe(18);
    expect(Number(MethodProfile.MWL.isha)).toBe(17);
    expect(Number(MethodProfile.Egyptian.fajr)).toBe(19.5);
    expect(Number(MethodProfile.Egyptian.isha)).toBe(17.5);
    expect(Number(MethodProfile.Karachi.fajr)).toBe(18);
    expect(Number(MethodProfile.Karachi.isha)).toBe(18);
    expect(Number(MethodProfile.UmmAlQura.fajr)).toBe(18.5);
    expect(Number(MethodProfile.UmmAlQura.ishaInterval)).toBe(90);
    expect(Number(MethodProfile.Dubai.fajr)).toBe(18.2);
    expect(Number(MethodProfile.Dubai.isha)).toBe(18.2);
    expect(Number(MethodProfile.Kuwait.fajr)).toBe(18);
    expect(Number(MethodProfile.Kuwait.isha)).toBe(17.5);
    expect(Number(MethodProfile.Qatar.fajr)).toBe(18);
    expect(Number(MethodProfile.Qatar.ishaInterval)).toBe(90);
    expect(Number(MethodProfile.MoonsightingCommittee.fajr)).toBe(18);
    expect(Number(MethodProfile.MoonsightingCommittee.isha)).toBe(18);
    expect(Number(MethodProfile.NorthAmerica.fajr)).toBe(15);
    expect(Number(MethodProfile.NorthAmerica.isha)).toBe(15);
    expect(Number(MethodProfile.ISNA.fajr)).toBe(15);
    expect(Number(MethodProfile.ISNA.isha)).toBe(15);
    expect(Number(MethodProfile.Singapore.fajr)).toBe(20);
    expect(Number(MethodProfile.Singapore.isha)).toBe(18);
    expect(Number(MethodProfile.Turkey.fajr)).toBe(18);
    expect(Number(MethodProfile.Turkey.isha)).toBe(17);
    expect(Number(MethodProfile.Other.fajr)).toBe(0);
    expect(Number(MethodProfile.Other.isha)).toBe(0);
  });
});
