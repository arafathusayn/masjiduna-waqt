import { test, expect, describe } from "bun:test";
import {
  computePrayerTimes,
  type PrayerTimesOutput,
} from "../../src/prayers.ts";
import {
  Latitude,
  Longitude,
  Meters,
  Minutes,
  Madhab,
  HighLatRule,
  PolarRule,
  MidnightMode,
  type PrayerTimeConfig,
} from "../../src/schema.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../../src/config.ts";
import { diffMin, getHHMM, assertValid, parseHHMM } from "../helpers.ts";

// ============================================================
// Configs
// ============================================================

const CHITTAGONG: PrayerTimeConfig = {
  latitude: Latitude.assert(22.3569),
  longitude: Longitude.assert(91.7832),
  date: Date.UTC(2026, 1, 25), // Feb 25, 2026
  timezoneId: "Asia/Dhaka",
  method: MethodProfile.MWL,
  madhab: Madhab.assert("hanafi"),
  highLatRule: HighLatRule.assert("twilight_angle"),
  polarRule: PolarRule.assert("unresolved"),
  midnightMode: MidnightMode.assert("standard"),
  adjustments: NO_ADJUSTMENTS,
  elevation: Meters.assert(0),
};

// ============================================================
// Chittagong — MWL Hanafi, Feb 25, 2026
// ============================================================

describe("Chittagong — MWL Hanafi, Feb 25 2026", () => {
  const result = computePrayerTimes(CHITTAGONG);
  const TZ = "Asia/Dhaka";

  test("all prayers are valid", () => {
    for (const p of [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "sunset",
      "maghrib",
      "isha",
      "midnight",
    ]) {
      const r = result[p as keyof PrayerTimesOutput];
      if (typeof r === "object" && "kind" in r) {
        expect(r.kind).toBe("valid");
      }
    }
  });

  test("Fajr is05:03", () => {
    expect(
      Math.abs(diffMin("05:03", getHHMM(result, "fajr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Sunrise is06:18", () => {
    expect(
      Math.abs(diffMin("06:18", getHHMM(result, "sunrise", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Dhuhr is12:06", () => {
    expect(
      Math.abs(diffMin("12:06", getHHMM(result, "dhuhr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Asr (Hanafi) is16:17", () => {
    expect(
      Math.abs(diffMin("16:17", getHHMM(result, "asr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Maghrib is17:55", () => {
    expect(
      Math.abs(diffMin("17:55", getHHMM(result, "maghrib", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Sunset is valid and equals Maghrib (no adjustment)", () => {
    assertValid(result.sunset);
    assertValid(result.maghrib);
    expect(result.sunset.ms).toBe(result.maghrib.ms);
  });

  test("Isha is19:05", () => {
    expect(
      Math.abs(diffMin("19:05", getHHMM(result, "isha", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Midnight is00:06", () => {
    expect(
      Math.abs(diffMin("00:06", getHHMM(result, "midnight", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("prayer order: Fajr < Sunrise < Dhuhr < Asr < Sunset <= Maghrib < Isha", () => {
    const prayers = [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "sunset",
      "maghrib",
      "isha",
    ] as const;
    const times = prayers.map((p) => {
      assertValid(result[p]);
      return result[p].ms;
    });
    for (let i = 1; i < times.length; i++) {
      const curr = times[i];
      const prev = times[i - 1];
      if (curr === undefined || prev === undefined)
        throw new Error("missing time");
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  test("midnight falls after Isha", () => {
    assertValid(result.midnight);
    assertValid(result.isha);
    expect(result.midnight.ms).toBeGreaterThan(result.isha.ms);
  });

  test("Imsak is exactly 10 minutes before Fajr", () => {
    assertValid(result.imsak);
    assertValid(result.fajr);
    const diffMs = result.fajr.ms - result.imsak.ms;
    expect(diffMs).toBe(10 * 60_000);
  });

  test("Firstthird is22:02 (±1 min)", () => {
    expect(
      Math.abs(diffMin("22:02", getHHMM(result, "firstThird", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Lastthird is02:10 (±1 min)", () => {
    expect(
      Math.abs(diffMin("02:10", getHHMM(result, "lastThird", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("ordering: Maghrib < Firstthird < Midnight < Lastthird < Fajr", () => {
    assertValid(result.maghrib);
    assertValid(result.firstThird);
    assertValid(result.midnight);
    assertValid(result.lastThird);
    assertValid(result.fajr);

    const maghribMs = result.maghrib.ms;
    const adj = (ms: number) => (ms < maghribMs ? ms + 86_400_000 : ms);

    expect(adj(result.firstThird.ms)).toBeGreaterThan(maghribMs);
    expect(adj(result.midnight.ms)).toBeGreaterThan(adj(result.firstThird.ms));
    expect(adj(result.lastThird.ms)).toBeGreaterThan(adj(result.midnight.ms));
    expect(adj(result.fajr.ms)).toBeGreaterThan(adj(result.lastThird.ms));
  });

  test("solar position metadata is reasonable", () => {
    expect(result.meta.declination).toBeGreaterThan(-11);
    expect(result.meta.declination).toBeLessThan(-8);
    expect(result.meta.eqtMinutes).toBeGreaterThan(-14);
    expect(result.meta.eqtMinutes).toBeLessThan(-12);
  });

  test("meta.solarNoonMs is a number near dhuhr", () => {
    const noonMs = result.meta.solarNoonMs;
    expect(typeof noonMs).toBe("number");
    // solarNoon should be within a few minutes of dhuhr
    if (result.dhuhr.kind === "valid") {
      expect(Math.abs(noonMs - result.dhuhr.ms)).toBeLessThan(10 * 60_000);
    }
    // calling it twice should return the same value
    expect(result.meta.solarNoonMs).toBe(noonMs);
  });
});

// ============================================================
// Chittagong — Karachi Hanafi, Feb 25 2026
// ============================================================

describe("Chittagong — Karachi Hanafi, Feb 25 2026", () => {
  const result = computePrayerTimes({
    ...CHITTAGONG,
    method: MethodProfile.Karachi,
  });
  const TZ = "Asia/Dhaka";

  test("Fajr is05:03", () => {
    expect(
      Math.abs(diffMin("05:03", getHHMM(result, "fajr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Isha (18 deg) is19:09", () => {
    expect(
      Math.abs(diffMin("19:09", getHHMM(result, "isha", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Karachi Isha is later than MWL Isha (18 deg vs 17 deg)", () => {
    const mwlResult = computePrayerTimes(CHITTAGONG);
    assertValid(result.isha);
    assertValid(mwlResult.isha);
    const diffMinutes = (result.isha.ms - mwlResult.isha.ms) / 60_000;
    expect(diffMinutes).toBeGreaterThan(3);
    expect(diffMinutes).toBeLessThan(25);
  });

  test("Karachi and MWL Fajr are identical (both 18 deg)", () => {
    const mwlResult = computePrayerTimes(CHITTAGONG);
    assertValid(result.fajr);
    assertValid(mwlResult.fajr);
    expect(Math.abs(result.fajr.ms - mwlResult.fajr.ms)).toBe(0);
  });
});

// ============================================================
// London — MWL Hanafi, Summer Solstice Jun 21 2026
// ============================================================

describe("London — MWL Hanafi, Summer Solstice Jun 21 2026", () => {
  const config: PrayerTimeConfig = {
    latitude: Latitude.assert(51.5074),
    longitude: Longitude.assert(-0.1278),
    date: Date.UTC(2026, 5, 21),
    timezoneId: "Europe/London",
    method: MethodProfile.MWL,
    madhab: Madhab.assert("hanafi"),
    highLatRule: HighLatRule.assert("twilight_angle"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  };
  const result = computePrayerTimes(config);
  const TZ = "Europe/London";

  test("all prayers are valid (high-lat fallback makes Fajr/Isha valid)", () => {
    for (const p of [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "sunset",
      "maghrib",
      "isha",
      "midnight",
    ]) {
      const r = result[p as keyof PrayerTimesOutput];
      if (typeof r === "object" && "kind" in r) {
        expect(r.kind).toBe("valid");
      }
    }
  });

  test("Fajr uses twilight_angle fallback (sun never reaches -18 deg)", () => {
    assertValid(result.fajr);
    expect(result.fajr.diagnostics.fallbackUsed).toBe("twilight_angle");
    expect(result.fajr.diagnostics.cosOmega).not.toBeNull();
    expect(result.fajr.diagnostics.cosOmega).toBeLessThan(-1);
  });

  test("Isha uses twilight_angle fallback (sun never reaches -17 deg)", () => {
    assertValid(result.isha);
    expect(result.isha.diagnostics.fallbackUsed).toBe("twilight_angle");
    expect(result.isha.diagnostics.cosOmega).not.toBeNull();
    expect(result.isha.diagnostics.cosOmega).toBeLessThan(-1);
  });

  test("Fajr is02:31", () => {
    expect(
      Math.abs(diffMin("02:31", getHHMM(result, "fajr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Sunrise is04:43", () => {
    expect(
      Math.abs(diffMin("04:43", getHHMM(result, "sunrise", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Dhuhr is13:02", () => {
    expect(
      Math.abs(diffMin("13:02", getHHMM(result, "dhuhr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Asr is18:40", () => {
    expect(
      Math.abs(diffMin("18:40", getHHMM(result, "asr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Maghrib is21:22", () => {
    expect(
      Math.abs(diffMin("21:22", getHHMM(result, "maghrib", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Isha is23:27", () => {
    expect(
      Math.abs(diffMin("23:27", getHHMM(result, "isha", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Midnight is01:02", () => {
    expect(
      Math.abs(diffMin("01:02", getHHMM(result, "midnight", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Sunrise/Dhuhr/Asr/Maghrib do NOT use fallback", () => {
    for (const p of ["sunrise", "dhuhr", "asr", "maghrib"] as const) {
      assertValid(result[p]);
      expect(result[p].diagnostics.fallbackUsed).toBeNull();
    }
  });

  test("Imsak, Firstthird, Lastthird are valid", () => {
    assertValid(result.imsak);
    assertValid(result.firstThird);
    assertValid(result.lastThird);
  });
});

// ============================================================
// New York — ISNA Hanafi, Dec 15 2026
// ============================================================

describe("New York — ISNA Hanafi, Dec 15 2026", () => {
  const config: PrayerTimeConfig = {
    latitude: Latitude.assert(40.7128),
    longitude: Longitude.assert(-74.006),
    date: Date.UTC(2026, 11, 15),
    timezoneId: "America/New_York",
    method: MethodProfile.ISNA,
    madhab: Madhab.assert("hanafi"),
    highLatRule: HighLatRule.assert("twilight_angle"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  };
  const result = computePrayerTimes(config);
  const TZ = "America/New_York";

  test("Fajr is05:51", () => {
    expect(
      Math.abs(diffMin("05:51", getHHMM(result, "fajr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Sunrise is07:13", () => {
    expect(
      Math.abs(diffMin("07:13", getHHMM(result, "sunrise", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Dhuhr is11:51", () => {
    expect(
      Math.abs(diffMin("11:51", getHHMM(result, "dhuhr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Asr is14:49", () => {
    expect(
      Math.abs(diffMin("14:49", getHHMM(result, "asr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Maghrib is16:29", () => {
    expect(
      Math.abs(diffMin("16:29", getHHMM(result, "maghrib", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Isha is17:52", () => {
    expect(
      Math.abs(diffMin("17:52", getHHMM(result, "isha", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Midnight is23:51", () => {
    expect(
      Math.abs(diffMin("23:51", getHHMM(result, "midnight", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("no fallbacks used (mid-latitude winter)", () => {
    for (const p of [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "maghrib",
      "isha",
    ] as const) {
      assertValid(result[p]);
      const fb = result[p].diagnostics.fallbackUsed;
      expect(fb === null || fb === "interval").toBe(true);
    }
  });
});

// ============================================================
// Mecca — Umm al-Qura Hanafi, Feb 25 2026
// ============================================================

describe("Mecca — Umm al-Qura Hanafi, Feb 25 2026", () => {
  const config: PrayerTimeConfig = {
    latitude: Latitude.assert(21.4225),
    longitude: Longitude.assert(39.8262),
    date: Date.UTC(2026, 1, 25),
    timezoneId: "Asia/Riyadh",
    method: MethodProfile.UmmAlQura,
    madhab: Madhab.assert("hanafi"),
    highLatRule: HighLatRule.assert("twilight_angle"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  };
  const result = computePrayerTimes(config);
  const TZ = "Asia/Riyadh";

  test("Fajr is05:28", () => {
    expect(
      Math.abs(diffMin("05:28", getHHMM(result, "fajr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Sunrise is06:45", () => {
    expect(
      Math.abs(diffMin("06:45", getHHMM(result, "sunrise", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Dhuhr is12:34", () => {
    expect(
      Math.abs(diffMin("12:34", getHHMM(result, "dhuhr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Asr is16:45", () => {
    expect(
      Math.abs(diffMin("16:45", getHHMM(result, "asr", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Maghrib is18:23", () => {
    expect(
      Math.abs(diffMin("18:23", getHHMM(result, "maghrib", TZ))),
    ).toBeLessThanOrEqual(1);
  });

  test("Isha is interval-based: Maghrib + 90 min", () => {
    assertValid(result.isha);
    assertValid(result.maghrib);
    const diffMs = result.isha.ms - result.maghrib.ms;
    expect(diffMs).toBe(90 * 60_000);
    expect(result.isha.diagnostics.fallbackUsed).toBe("interval");
  });

  test("Isha is 30 min earlier than 20:23 (Ramadan +30 offset not applied)", () => {
    const referenceIsha = "20:23";
    const ourIsha = getHHMM(result, "isha", TZ);
    const diff = diffMin(ourIsha, referenceIsha);
    expect(diff).toBeGreaterThanOrEqual(29);
    expect(diff).toBeLessThanOrEqual(31);
  });
});

// ============================================================
// Cairo — MWL Shafi, Jun 21 2022
// ============================================================

describe("Cairo — MWL Shafi, Jun 21 2022", () => {
  const config: PrayerTimeConfig = {
    latitude: Latitude.assert(30.0444),
    longitude: Longitude.assert(31.2357),
    date: Date.UTC(2022, 5, 21),
    timezoneId: "Africa/Cairo",
    method: MethodProfile.MWL,
    madhab: Madhab.assert("standard"),
    highLatRule: HighLatRule.assert("twilight_angle"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  };
  const result = computePrayerTimes(config);
  const TZ = "Africa/Cairo";

  const REFERENCE: Record<string, string> = {
    fajr: "03:18",
    sunrise: "04:54",
    dhuhr: "11:57",
    asr: "15:32",
    maghrib: "18:59",
    isha: "20:30",
    imsak: "03:08",
    midnight: "23:57",
    firstThird: "22:18",
    lastThird: "01:36",
  };

  for (const [prayer, expected] of Object.entries(REFERENCE)) {
    test(`${prayer} is${expected}`, () => {
      expect(
        Math.abs(diffMin(expected, getHHMM(result, prayer, TZ))),
      ).toBeLessThanOrEqual(1);
    });
  }

  test("no fallbacks used (mid-latitude)", () => {
    for (const p of [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "maghrib",
      "isha",
    ] as const) {
      assertValid(result[p]);
      expect(result[p].diagnostics.fallbackUsed).toBeNull();
    }
  });

  test("ordering: Maghrib < Firstthird < Midnight < Lastthird < Fajr", () => {
    assertValid(result.maghrib);
    assertValid(result.firstThird);
    assertValid(result.midnight);
    assertValid(result.lastThird);
    assertValid(result.fajr);

    const maghribMs = result.maghrib.ms;
    const adj = (ms: number) => (ms < maghribMs ? ms + 86_400_000 : ms);

    expect(adj(result.firstThird.ms)).toBeGreaterThan(maghribMs);
    expect(adj(result.midnight.ms)).toBeGreaterThan(adj(result.firstThird.ms));
    expect(adj(result.lastThird.ms)).toBeGreaterThan(adj(result.midnight.ms));
    expect(adj(result.fajr.ms)).toBeGreaterThan(adj(result.lastThird.ms));
  });
});

// ============================================================
// Sydney — Karachi Hanafi, Dec 21 2026
// ============================================================

describe("Sydney — Karachi Hanafi, Dec 21 2026", () => {
  const config: PrayerTimeConfig = {
    latitude: Latitude.assert(-33.8688),
    longitude: Longitude.assert(151.2093),
    date: Date.UTC(2026, 11, 21),
    timezoneId: "Australia/Sydney",
    method: MethodProfile.Karachi,
    madhab: Madhab.assert("hanafi"),
    highLatRule: HighLatRule.assert("twilight_angle"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  };
  const result = computePrayerTimes(config);
  const TZ = "Australia/Sydney";

  const REFERENCE: Record<string, string> = {
    fajr: "03:56",
    sunrise: "05:41",
    dhuhr: "12:53",
    asr: "17:54",
    maghrib: "20:05",
    isha: "21:50",
    imsak: "03:46",
    midnight: "00:53",
    firstThird: "23:17",
    lastThird: "02:29",
  };

  for (const [prayer, expected] of Object.entries(REFERENCE)) {
    test(`${prayer} is${expected}`, () => {
      expect(
        Math.abs(diffMin(expected, getHHMM(result, prayer, TZ))),
      ).toBeLessThanOrEqual(1);
    });
  }

  test("ordering: Maghrib < Firstthird < Midnight < Lastthird < Fajr", () => {
    assertValid(result.maghrib);
    assertValid(result.firstThird);
    assertValid(result.midnight);
    assertValid(result.lastThird);
    assertValid(result.fajr);

    const maghribMs = result.maghrib.ms;
    const adj = (ms: number) => (ms < maghribMs ? ms + 86_400_000 : ms);

    expect(adj(result.firstThird.ms)).toBeGreaterThan(maghribMs);
    expect(adj(result.midnight.ms)).toBeGreaterThan(adj(result.firstThird.ms));
    expect(adj(result.lastThird.ms)).toBeGreaterThan(adj(result.midnight.ms));
    expect(adj(result.fajr.ms)).toBeGreaterThan(adj(result.lastThird.ms));
  });
});

// ============================================================
// Jakarta — Singapore Shafi, Dec 25 2023
// ============================================================

describe("Jakarta — Singapore Shafi, Dec 25 2023", () => {
  const config: PrayerTimeConfig = {
    latitude: Latitude.assert(-6.2088),
    longitude: Longitude.assert(106.8456),
    date: Date.UTC(2023, 11, 25),
    timezoneId: "Asia/Jakarta",
    method: MethodProfile.Singapore,
    madhab: Madhab.assert("standard"),
    highLatRule: HighLatRule.assert("twilight_angle"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  };
  const result = computePrayerTimes(config);
  const TZ = "Asia/Jakarta";

  const REFERENCE: Record<string, string> = {
    fajr: "04:12",
    sunrise: "05:38",
    dhuhr: "11:52",
    asr: "15:20",
    maghrib: "18:07",
    isha: "19:23",
    imsak: "04:02",
    midnight: "23:52",
    firstThird: "21:57",
    lastThird: "01:48",
  };

  for (const [prayer, expected] of Object.entries(REFERENCE)) {
    test(`${prayer} is${expected}`, () => {
      expect(
        Math.abs(diffMin(expected, getHHMM(result, prayer, TZ))),
      ).toBeLessThanOrEqual(1);
    });
  }

  test("no fallbacks used (equatorial)", () => {
    for (const p of [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "maghrib",
      "isha",
    ] as const) {
      assertValid(result[p]);
      expect(result[p].diagnostics.fallbackUsed).toBeNull();
    }
  });

  test("ordering: Maghrib < Firstthird < Midnight < Lastthird < Fajr", () => {
    assertValid(result.maghrib);
    assertValid(result.firstThird);
    assertValid(result.midnight);
    assertValid(result.lastThird);
    assertValid(result.fajr);

    const maghribMs = result.maghrib.ms;
    const adj = (ms: number) => (ms < maghribMs ? ms + 86_400_000 : ms);

    expect(adj(result.firstThird.ms)).toBeGreaterThan(maghribMs);
    expect(adj(result.midnight.ms)).toBeGreaterThan(adj(result.firstThird.ms));
    expect(adj(result.lastThird.ms)).toBeGreaterThan(adj(result.midnight.ms));
    expect(adj(result.fajr.ms)).toBeGreaterThan(adj(result.lastThird.ms));
  });
});

// ============================================================
// Polar region — undefined sunrise/sunset (no high-lat fallback)
// ============================================================

describe("Polar region — undefined sunrise/sunset", () => {
  const config: PrayerTimeConfig = {
    latitude: Latitude.assert(71.0),
    longitude: Longitude.assert(25.78),
    date: Date.UTC(2026, 5, 21),
    timezoneId: "Europe/Oslo",
    method: MethodProfile.MWL,
    madhab: Madhab.assert("hanafi"),
    highLatRule: HighLatRule.assert("none"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  };
  const result = computePrayerTimes(config);

  test("sunset is undefined in polar region", () => {
    expect(result.sunset.kind).toBe("undefined");
  });

  test("midnight is undefined when sunrise/sunset are undefined", () => {
    expect(result.midnight.kind).toBe("undefined");
    if (result.midnight.kind === "undefined") {
      expect(result.midnight.reason).toBe("sunset or sunrise undefined");
    }
  });

  test("firstThird and lastThird are undefined when sunrise/sunset are undefined", () => {
    expect(result.firstThird.kind).toBe("undefined");
    expect(result.lastThird.kind).toBe("undefined");
    if (result.firstThird.kind === "undefined") {
      expect(result.firstThird.reason).toBe("sunset or sunrise undefined");
    }
    if (result.lastThird.kind === "undefined") {
      expect(result.lastThird.reason).toBe("sunset or sunrise undefined");
    }
  });

  test("imsak is undefined when fajr is undefined", () => {
    expect(result.fajr.kind).toBe("undefined");
    expect(result.imsak.kind).toBe("undefined");
    if (result.imsak.kind === "undefined") {
      expect(result.imsak.reason).toBe("fajr is undefined");
    }
  });

  test("getHHMM throws for undefined prayer", () => {
    expect(() => getHHMM(result, "fajr", "Europe/Oslo")).toThrow(
      "fajr is not valid",
    );
  });

  test("assertValid throws for undefined prayer", () => {
    expect(() => assertValid(result.fajr)).toThrow(
      "Expected valid, got undefined",
    );
  });
});

// ============================================================
// Sunset vs Maghrib with adjustment
// ============================================================

describe("Sunset vs Maghrib with adjustment", () => {
  test("maghrib adjustment shifts maghrib but not sunset", () => {
    const noAdj = computePrayerTimes(CHITTAGONG);
    const withAdj = computePrayerTimes({
      ...CHITTAGONG,
      adjustments: { ...NO_ADJUSTMENTS, maghrib: Minutes.assert(3) },
    });
    assertValid(noAdj.sunset);
    assertValid(noAdj.maghrib);
    assertValid(withAdj.sunset);
    assertValid(withAdj.maghrib);
    // Sunset unchanged
    expect(withAdj.sunset.ms).toBe(noAdj.sunset.ms);
    // Maghrib shifted by 3 minutes
    expect(withAdj.maghrib.ms - noAdj.maghrib.ms).toBe(3 * 60_000);
    // Maghrib = sunset + 3 min
    expect(withAdj.maghrib.ms - withAdj.sunset.ms).toBe(3 * 60_000);
  });
});

// ============================================================
// Hanafi vs Shafi Asr difference
// ============================================================

describe("Hanafi vs Standard Asr difference", () => {
  test("Hanafi Asr is 30-90 minutes later than Standard", () => {
    const hanafiResult = computePrayerTimes({
      ...CHITTAGONG,
      madhab: Madhab.assert("hanafi"),
    });
    const standardResult = computePrayerTimes({
      ...CHITTAGONG,
      madhab: Madhab.assert("standard"),
    });
    assertValid(hanafiResult.asr);
    assertValid(standardResult.asr);
    const diff = (hanafiResult.asr.ms - standardResult.asr.ms) / 60_000;
    expect(diff).toBeGreaterThanOrEqual(30);
    expect(diff).toBeLessThanOrEqual(90);
  });
});

// ============================================================
// Dhuhr adjustment
// ============================================================

describe("Dhuhr adjustment", () => {
  test("+1 minute adjustment shifts Dhuhr by exactly 1 minute", () => {
    const noAdj = computePrayerTimes(CHITTAGONG);
    const withAdj = computePrayerTimes({
      ...CHITTAGONG,
      adjustments: { ...NO_ADJUSTMENTS, dhuhr: Minutes.assert(1) },
    });
    assertValid(noAdj.dhuhr);
    assertValid(withAdj.dhuhr);
    expect(withAdj.dhuhr.ms - noAdj.dhuhr.ms).toBe(60_000);
  });
});

// ============================================================
// Elevation adjusts sunrise/sunset
// ============================================================

describe("elevation adjusts sunrise/sunset", () => {
  test("higher elevation produces earlier sunrise and later sunset", () => {
    const seaLevel = computePrayerTimes({
      ...CHITTAGONG,
      elevation: Meters.assert(0),
    });
    const elevated = computePrayerTimes({
      ...CHITTAGONG,
      elevation: Meters.assert(1000),
    });
    assertValid(seaLevel.sunrise);
    assertValid(elevated.sunrise);
    assertValid(seaLevel.sunset);
    assertValid(elevated.sunset);
    expect(elevated.sunrise.ms).toBeLessThan(seaLevel.sunrise.ms);
    expect(elevated.sunset.ms).toBeGreaterThan(seaLevel.sunset.ms);
  });
});
