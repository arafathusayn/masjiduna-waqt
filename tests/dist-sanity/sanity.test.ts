/**
 * Dist sanity tests — imports from the built ESM artifact (dist/index.js).
 * Run after `bun run build` via `bun run test:dist`.
 */

import { test, expect, describe } from "bun:test";
import {
  // Schema validators
  Latitude,
  Longitude,
  Meters,
  Degrees,
  Minutes,
  Madhab,
  HighLatRule,
  PolarRule,
  MidnightMode,
  Prayer,
  Rounding,
  Shafaq,
  // Trig helpers (also checked in Group T)
  sinDeg,
  cosDeg,
  tanDeg,
  normalizeDeg,
  asinDeg,
  atan2Deg,
  // Config
  MethodProfile,
  NO_ADJUSTMENTS,
  METHOD_ADJUSTMENTS,
  shadowFactor,
  // Core
  computePrayerTimes,
  createPrayerContext,
  clearSolarCache,
  // Solar
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
  // Hour angle
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
  // High latitude
  applyHighLatFallback,
  // Formatting
  formatLocal,
  // Date utilities
  isLeapYear,
  dayOfYear,
  dateByAddingDays,
  dateByAddingMinutes,
  dateByAddingSeconds,
  roundedMinute,
  decomposeHours,
  daysSinceSolstice,
  // Qibla
  computeQibla,
  // Prayer utilities
  timeForPrayer,
  currentPrayer,
  nextPrayer,
  nightPortions,
  recommendedHighLatRule,
  // Sunnah times
  computeSunnahTimes,
  // Moonsighting
  seasonAdjustedMorningTwilight,
  seasonAdjustedEveningTwilight,
} from "../../dist/index.js";

// ============================================================
// A — Export existence
// ============================================================

describe("A — Export existence", () => {
  // Schema
  test("Latitude is object", () => expect(typeof Latitude).toBe("object"));
  test("Longitude is object", () => expect(typeof Longitude).toBe("object"));
  test("Meters is object", () => expect(typeof Meters).toBe("object"));
  test("Degrees is object", () => expect(typeof Degrees).toBe("object"));
  test("Minutes is object", () => expect(typeof Minutes).toBe("object"));
  test("Madhab is object", () => expect(typeof Madhab).toBe("object"));
  test("HighLatRule is object", () =>
    expect(typeof HighLatRule).toBe("object"));
  test("PolarRule is object", () => expect(typeof PolarRule).toBe("object"));
  test("MidnightMode is object", () =>
    expect(typeof MidnightMode).toBe("object"));
  test("Prayer is object", () => expect(typeof Prayer).toBe("object"));
  test("Rounding is object", () => expect(typeof Rounding).toBe("object"));
  test("Shafaq is object", () => expect(typeof Shafaq).toBe("object"));

  // Config
  test("MethodProfile is object", () =>
    expect(typeof MethodProfile).toBe("object"));
  test("NO_ADJUSTMENTS is object", () =>
    expect(typeof NO_ADJUSTMENTS).toBe("object"));
  test("METHOD_ADJUSTMENTS is object", () =>
    expect(typeof METHOD_ADJUSTMENTS).toBe("object"));
  test("shadowFactor is function", () =>
    expect(typeof shadowFactor).toBe("function"));

  // Core
  test("computePrayerTimes is function", () =>
    expect(typeof computePrayerTimes).toBe("function"));
  test("createPrayerContext is function", () =>
    expect(typeof createPrayerContext).toBe("function"));
  test("clearSolarCache is function", () =>
    expect(typeof clearSolarCache).toBe("function"));

  // Solar
  test("toJulianDate is function", () =>
    expect(typeof toJulianDate).toBe("function"));
  test("toJulianCentury is function", () =>
    expect(typeof toJulianCentury).toBe("function"));
  test("solarPosition is function", () =>
    expect(typeof solarPosition).toBe("function"));
  test("meanSolarLongitude is function", () =>
    expect(typeof meanSolarLongitude).toBe("function"));
  test("meanSolarAnomaly is function", () =>
    expect(typeof meanSolarAnomaly).toBe("function"));
  test("solarEquationOfTheCenter is function", () =>
    expect(typeof solarEquationOfTheCenter).toBe("function"));
  test("apparentSolarLongitude is function", () =>
    expect(typeof apparentSolarLongitude).toBe("function"));
  test("meanObliquityOfTheEcliptic is function", () =>
    expect(typeof meanObliquityOfTheEcliptic).toBe("function"));
  test("apparentObliquityOfTheEcliptic is function", () =>
    expect(typeof apparentObliquityOfTheEcliptic).toBe("function"));
  test("meanLunarLongitude is function", () =>
    expect(typeof meanLunarLongitude).toBe("function"));
  test("ascendingLunarNodeLongitude is function", () =>
    expect(typeof ascendingLunarNodeLongitude).toBe("function"));
  test("nutationInLongitude is function", () =>
    expect(typeof nutationInLongitude).toBe("function"));
  test("nutationInObliquity is function", () =>
    expect(typeof nutationInObliquity).toBe("function"));
  test("meanSiderealTime is function", () =>
    expect(typeof meanSiderealTime).toBe("function"));

  // Hour angle
  test("computeHourAngle is function", () =>
    expect(typeof computeHourAngle).toBe("function"));
  test("hourAngleToHours is function", () =>
    expect(typeof hourAngleToHours).toBe("function"));
  test("normalizeToScale is function", () =>
    expect(typeof normalizeToScale).toBe("function"));
  test("altitudeOfCelestialBody is function", () =>
    expect(typeof altitudeOfCelestialBody).toBe("function"));
  test("approximateTransit is function", () =>
    expect(typeof approximateTransit).toBe("function"));
  test("correctedTransit is function", () =>
    expect(typeof correctedTransit).toBe("function"));
  test("correctedHourAngle is function", () =>
    expect(typeof correctedHourAngle).toBe("function"));
  test("interpolate is function", () =>
    expect(typeof interpolate).toBe("function"));
  test("interpolateAngles is function", () =>
    expect(typeof interpolateAngles).toBe("function"));
  test("quadrantShiftAngle is function", () =>
    expect(typeof quadrantShiftAngle).toBe("function"));

  // High latitude
  test("applyHighLatFallback is function", () =>
    expect(typeof applyHighLatFallback).toBe("function"));

  // Format
  test("formatLocal is function", () =>
    expect(typeof formatLocal).toBe("function"));

  // Date utilities
  test("isLeapYear is function", () =>
    expect(typeof isLeapYear).toBe("function"));
  test("dayOfYear is function", () =>
    expect(typeof dayOfYear).toBe("function"));
  test("dateByAddingDays is function", () =>
    expect(typeof dateByAddingDays).toBe("function"));
  test("dateByAddingMinutes is function", () =>
    expect(typeof dateByAddingMinutes).toBe("function"));
  test("dateByAddingSeconds is function", () =>
    expect(typeof dateByAddingSeconds).toBe("function"));
  test("roundedMinute is function", () =>
    expect(typeof roundedMinute).toBe("function"));
  test("decomposeHours is function", () =>
    expect(typeof decomposeHours).toBe("function"));
  test("daysSinceSolstice is function", () =>
    expect(typeof daysSinceSolstice).toBe("function"));

  // Qibla
  test("computeQibla is function", () =>
    expect(typeof computeQibla).toBe("function"));

  // Prayer utilities
  test("timeForPrayer is function", () =>
    expect(typeof timeForPrayer).toBe("function"));
  test("currentPrayer is function", () =>
    expect(typeof currentPrayer).toBe("function"));
  test("nextPrayer is function", () =>
    expect(typeof nextPrayer).toBe("function"));
  test("nightPortions is function", () =>
    expect(typeof nightPortions).toBe("function"));
  test("recommendedHighLatRule is function", () =>
    expect(typeof recommendedHighLatRule).toBe("function"));

  // Sunnah
  test("computeSunnahTimes is function", () =>
    expect(typeof computeSunnahTimes).toBe("function"));

  // Moonsighting
  test("seasonAdjustedMorningTwilight is function", () =>
    expect(typeof seasonAdjustedMorningTwilight).toBe("function"));
  test("seasonAdjustedEveningTwilight is function", () =>
    expect(typeof seasonAdjustedEveningTwilight).toBe("function"));
});

// ============================================================
// B — Schema validators (behavior)
// ============================================================

describe("B — Schema validators", () => {
  test("Latitude.assert accepts valid", () =>
    expect(Latitude.assert(22.36)).toBe(22.36));
  test("Latitude.assert rejects > 90", () =>
    expect(() => Latitude.assert(91)).toThrow(RangeError));
  test("Latitude.assert rejects < -90", () =>
    expect(() => Latitude.assert(-91)).toThrow(RangeError));

  test("Longitude.assert accepts valid", () =>
    expect(Longitude.assert(39.82)).toBe(39.82));
  test("Longitude.assert rejects > 180", () =>
    expect(() => Longitude.assert(181)).toThrow(RangeError));
  test("Longitude.assert rejects < -180", () =>
    expect(() => Longitude.assert(-181)).toThrow(RangeError));

  test("Meters.assert accepts 0", () => expect(Meters.assert(0)).toBe(0));
  test("Meters.assert accepts positive", () =>
    expect(Meters.assert(100)).toBe(100));
  test("Meters.assert rejects negative", () =>
    expect(() => Meters.assert(-1)).toThrow(RangeError));

  test("Madhab.assert accepts standard", () =>
    expect(Madhab.assert("standard")).toBe("standard"));
  test("Madhab.assert accepts hanafi", () =>
    expect(Madhab.assert("hanafi")).toBe("hanafi"));
  test("Madhab.assert rejects invalid", () =>
    expect(() => Madhab.assert("other")).toThrow(TypeError));

  test("HighLatRule.assert accepts middle_of_night", () =>
    expect(HighLatRule.assert("middle_of_night")).toBe("middle_of_night"));
  test("HighLatRule.assert accepts seventh_of_night", () =>
    expect(HighLatRule.assert("seventh_of_night")).toBe("seventh_of_night"));
  test("HighLatRule.assert accepts twilight_angle", () =>
    expect(HighLatRule.assert("twilight_angle")).toBe("twilight_angle"));
  test("HighLatRule.assert accepts none", () =>
    expect(HighLatRule.assert("none")).toBe("none"));
  test("HighLatRule.assert rejects invalid", () =>
    expect(() => HighLatRule.assert("bad")).toThrow(TypeError));

  test("Prayer.assert accepts fajr", () =>
    expect(Prayer.assert("fajr")).toBe("fajr"));
  test("Prayer.assert accepts sunrise", () =>
    expect(Prayer.assert("sunrise")).toBe("sunrise"));
  test("Prayer.assert accepts dhuhr", () =>
    expect(Prayer.assert("dhuhr")).toBe("dhuhr"));
  test("Prayer.assert accepts asr", () =>
    expect(Prayer.assert("asr")).toBe("asr"));
  test("Prayer.assert accepts maghrib", () =>
    expect(Prayer.assert("maghrib")).toBe("maghrib"));
  test("Prayer.assert accepts isha", () =>
    expect(Prayer.assert("isha")).toBe("isha"));
  test("Prayer.assert accepts none", () =>
    expect(Prayer.assert("none")).toBe("none"));
  test("Prayer.assert rejects invalid", () =>
    expect(() => Prayer.assert("jummah")).toThrow(TypeError));

  test("Rounding.assert accepts nearest", () =>
    expect(Rounding.assert("nearest")).toBe("nearest"));
  test("Rounding.assert accepts up", () =>
    expect(Rounding.assert("up")).toBe("up"));
  test("Rounding.assert accepts none", () =>
    expect(Rounding.assert("none")).toBe("none"));
  test("Rounding.assert rejects invalid", () =>
    expect(() => Rounding.assert("down")).toThrow(TypeError));

  test("Shafaq.assert accepts general", () =>
    expect(Shafaq.assert("general")).toBe("general"));
  test("Shafaq.assert accepts ahmer", () =>
    expect(Shafaq.assert("ahmer")).toBe("ahmer"));
  test("Shafaq.assert accepts abyad", () =>
    expect(Shafaq.assert("abyad")).toBe("abyad"));
  test("Shafaq.assert rejects invalid", () =>
    expect(() => Shafaq.assert("red")).toThrow(TypeError));
});

// ============================================================
// C — MethodProfile completeness
// ============================================================

describe("C — MethodProfile completeness", () => {
  const methods = [
    "Karachi",
    "Turkey",
    "MWL",
    "ISNA",
    "Egyptian",
    "UmmAlQura",
    "Singapore",
    "Dubai",
    "Kuwait",
    "Qatar",
    "MoonsightingCommittee",
    "NorthAmerica",
    "Other",
  ] as const;

  for (const name of methods) {
    test(`${name} has numeric fajr and isha`, () => {
      const m = MethodProfile[name];
      expect(m).toBeDefined();
      expect(typeof m.fajr).toBe("number");
      expect(typeof m.isha).toBe("number");
    });
  }

  test("exactly 13 methods defined", () => {
    expect(Object.keys(MethodProfile).length).toBe(13);
  });
});

// ============================================================
// D — shadowFactor
// ============================================================

describe("D — shadowFactor", () => {
  test("standard → 1", () => expect(shadowFactor("standard")).toBe(1));
  test("hanafi → 2", () => expect(shadowFactor("hanafi")).toBe(2));
});

// ============================================================
// Shared configs
// ============================================================

const MECCA_CONFIG = {
  latitude: 21.4225,
  longitude: 39.8262,
  date: Date.UTC(2026, 1, 25), // Feb 25 2026
  timezoneId: "Asia/Riyadh",
  method: MethodProfile.UmmAlQura,
  madhab: "standard" as const,
  highLatRule: "middle_of_night" as const,
  polarRule: "unresolved" as const,
  midnightMode: "standard" as const,
  adjustments: NO_ADJUSTMENTS,
  elevation: 0,
};

const CHITTAGONG_CONFIG = {
  latitude: 22.3569,
  longitude: 91.7832,
  date: Date.UTC(2026, 1, 25),
  timezoneId: "Asia/Dhaka",
  method: MethodProfile.MWL,
  madhab: "standard" as const,
  highLatRule: "twilight_angle" as const,
  polarRule: "unresolved" as const,
  midnightMode: "standard" as const,
  adjustments: NO_ADJUSTMENTS,
  elevation: 0,
};

// ============================================================
// E — computePrayerTimes (Mecca / UmmAlQura)
// ============================================================

describe("E — computePrayerTimes (Mecca, UmmAlQura)", () => {
  const result = computePrayerTimes(MECCA_CONFIG);

  const prayerKeys = [
    "fajr",
    "sunrise",
    "dhuhr",
    "asr",
    "sunset",
    "maghrib",
    "isha",
    "midnight",
    "imsak",
    "firstThird",
    "lastThird",
  ] as const;

  test("all 11 output keys present", () => {
    for (const k of prayerKeys) {
      expect(result[k]).toBeDefined();
    }
  });

  test("all prayers are kind:valid", () => {
    for (const k of prayerKeys) {
      expect(result[k].kind).toBe("valid");
    }
  });

  test("each valid prayer has numeric ms", () => {
    for (const k of prayerKeys) {
      const r = result[k];
      if (r.kind === "valid") {
        expect(typeof r.ms).toBe("number");
        expect(Number.isFinite(r.ms)).toBe(true);
      }
    }
  });

  test("each valid prayer has diagnostics with cosOmega, clamped, targetAltitude", () => {
    for (const k of [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "sunset",
      "maghrib",
      "isha",
    ] as const) {
      const r = result[k];
      if (r.kind === "valid") {
        expect(typeof r.diagnostics.clamped).toBe("boolean");
        expect(typeof r.diagnostics.targetAltitude).toBe("number");
        // cosOmega is null for dhuhr, numeric for others
      }
    }
  });

  test("monotonic ordering: fajr < sunrise < dhuhr < asr < sunset < isha", () => {
    const r = result;
    if (
      r.fajr.kind !== "valid" ||
      r.sunrise.kind !== "valid" ||
      r.dhuhr.kind !== "valid" ||
      r.asr.kind !== "valid" ||
      r.sunset.kind !== "valid" ||
      r.isha.kind !== "valid"
    ) {
      throw new Error("Expected all valid");
    }
    expect(r.fajr.ms).toBeLessThan(r.sunrise.ms);
    expect(r.sunrise.ms).toBeLessThan(r.dhuhr.ms);
    expect(r.dhuhr.ms).toBeLessThan(r.asr.ms);
    expect(r.asr.ms).toBeLessThan(r.sunset.ms);
    expect(r.sunset.ms).toBeLessThan(r.isha.ms);
  });

  test("meta has finite numeric fields", () => {
    expect(Number.isFinite(result.meta.declination)).toBe(true);
    expect(Number.isFinite(result.meta.eqtMinutes)).toBe(true);
    expect(Number.isFinite(result.meta.solarNoonMs)).toBe(true);
    expect(Number.isFinite(result.meta.julianDate)).toBe(true);
  });

  test("formatLocal(fajr.ms) matches HH:MM pattern", () => {
    if (result.fajr.kind !== "valid") throw new Error("Expected valid fajr");
    const formatted = formatLocal(result.fajr.ms, "Asia/Riyadh");
    expect(formatted).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ============================================================
// F — computePrayerTimes (London summer, twilight_angle fallback)
// ============================================================

describe("F — computePrayerTimes (London, Jun 21, twilight_angle)", () => {
  const londonConfig = {
    latitude: 51.5074,
    longitude: -0.1278,
    date: Date.UTC(2026, 5, 21), // Jun 21 2026
    timezoneId: "Europe/London",
    method: MethodProfile.MWL,
    madhab: "standard" as const,
    highLatRule: "twilight_angle" as const,
    polarRule: "unresolved" as const,
    midnightMode: "standard" as const,
    adjustments: NO_ADJUSTMENTS,
    elevation: 0,
  };

  const result = computePrayerTimes(londonConfig);

  test("all prayers are kind:valid with twilight_angle fallback", () => {
    const keys = [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "sunset",
      "maghrib",
      "isha",
    ] as const;
    for (const k of keys) {
      expect(result[k].kind).toBe("valid");
    }
  });

  test("fajr fallbackUsed is non-null (high-lat fallback applied)", () => {
    if (result.fajr.kind !== "valid") throw new Error("Expected valid fajr");
    expect(result.fajr.diagnostics.fallbackUsed).not.toBeNull();
  });

  test("daytime ordering holds: sunrise < dhuhr < asr < sunset", () => {
    const r = result;
    if (
      r.sunrise.kind !== "valid" ||
      r.dhuhr.kind !== "valid" ||
      r.asr.kind !== "valid" ||
      r.sunset.kind !== "valid" ||
      r.isha.kind !== "valid"
    ) {
      throw new Error("Expected all valid");
    }
    expect(r.sunrise.ms).toBeLessThan(r.dhuhr.ms);
    expect(r.dhuhr.ms).toBeLessThan(r.asr.ms);
    expect(r.asr.ms).toBeLessThan(r.sunset.ms);
    expect(r.sunset.ms).toBeLessThan(r.isha.ms);
  });
});

// ============================================================
// G — computePrayerTimes (polar undefined, highLatRule:none)
// ============================================================

describe("G — computePrayerTimes (polar, highLatRule:none)", () => {
  const polarConfig = {
    latitude: 69.6,
    longitude: 18.96,
    date: Date.UTC(2026, 5, 21), // Jun 21 2026
    timezoneId: "Europe/Oslo",
    method: MethodProfile.MWL,
    madhab: "standard" as const,
    highLatRule: "none" as const,
    polarRule: "unresolved" as const,
    midnightMode: "standard" as const,
    adjustments: NO_ADJUSTMENTS,
    elevation: 0,
  };

  const result = computePrayerTimes(polarConfig);

  test("fajr kind is undefined (midnight sun)", () => {
    expect(result.fajr.kind).toBe("undefined");
  });

  test("isha kind is undefined (midnight sun)", () => {
    expect(result.isha.kind).toBe("undefined");
  });
});

// ============================================================
// H — createPrayerContext parity
// ============================================================

describe("H — createPrayerContext parity with computePrayerTimes", () => {
  const ctx = createPrayerContext({
    latitude: MECCA_CONFIG.latitude,
    longitude: MECCA_CONFIG.longitude,
    timezoneId: MECCA_CONFIG.timezoneId,
    method: MECCA_CONFIG.method,
    madhab: MECCA_CONFIG.madhab,
    highLatRule: MECCA_CONFIG.highLatRule,
    polarRule: MECCA_CONFIG.polarRule,
    midnightMode: MECCA_CONFIG.midnightMode,
    adjustments: MECCA_CONFIG.adjustments,
    elevation: MECCA_CONFIG.elevation,
  });

  const baseDate = Date.UTC(2026, 1, 25);

  for (let i = 0; i < 7; i++) {
    const date = baseDate + i * 86_400_000;
    test(`day ${i}: context ms matches computePrayerTimes ms`, () => {
      const ctxResult = ctx.compute(date);
      const directResult = computePrayerTimes({ ...MECCA_CONFIG, date });

      const keys = [
        "fajr",
        "sunrise",
        "dhuhr",
        "asr",
        "sunset",
        "maghrib",
        "isha",
      ] as const;
      for (const k of keys) {
        const cr = ctxResult[k];
        const dr = directResult[k];
        expect(cr.kind).toBe(dr.kind);
        if (cr.kind === "valid" && dr.kind === "valid") {
          expect(cr.ms).toBe(dr.ms);
        }
      }
    });

    test(`day ${i}: context meta matches computePrayerTimes meta`, () => {
      const ctxResult = ctx.compute(date);
      const directResult = computePrayerTimes({ ...MECCA_CONFIG, date });
      expect(ctxResult.meta.julianDate).toBe(directResult.meta.julianDate);
      expect(ctxResult.meta.declination).toBe(directResult.meta.declination);
      expect(ctxResult.meta.eqtMinutes).toBe(directResult.meta.eqtMinutes);
    });
  }
});

// ============================================================
// I — Hanafi vs Standard Asr
// ============================================================

describe("I — Hanafi vs Standard Asr", () => {
  const standard = computePrayerTimes({
    ...CHITTAGONG_CONFIG,
    madhab: "standard",
  });
  const hanafi = computePrayerTimes({ ...CHITTAGONG_CONFIG, madhab: "hanafi" });

  test("hanafi asr.ms > standard asr.ms (shadow factor 2 vs 1)", () => {
    if (standard.asr.kind !== "valid" || hanafi.asr.kind !== "valid") {
      throw new Error("Expected valid");
    }
    expect(hanafi.asr.ms).toBeGreaterThan(standard.asr.ms);
  });
});

// ============================================================
// J — Adjustments
// ============================================================

describe("J — Adjustments", () => {
  const base = computePrayerTimes(CHITTAGONG_CONFIG);
  const adjusted = computePrayerTimes({
    ...CHITTAGONG_CONFIG,
    adjustments: {
      fajr: 5,
      sunrise: 0,
      dhuhr: 0,
      asr: 0,
      maghrib: 0,
      isha: -3,
    },
  });

  test("fajr.ms shifted by +5 minutes", () => {
    if (base.fajr.kind !== "valid" || adjusted.fajr.kind !== "valid") {
      throw new Error("Expected valid");
    }
    expect(adjusted.fajr.ms).toBe(base.fajr.ms + 5 * 60_000);
  });

  test("isha.ms shifted by -3 minutes", () => {
    if (base.isha.kind !== "valid" || adjusted.isha.kind !== "valid") {
      throw new Error("Expected valid");
    }
    expect(adjusted.isha.ms).toBe(base.isha.ms - 3 * 60_000);
  });
});

// ============================================================
// K — Elevation effect
// ============================================================

describe("K — Elevation effect", () => {
  const base = computePrayerTimes({ ...CHITTAGONG_CONFIG, elevation: 0 });
  const elevated = computePrayerTimes({ ...CHITTAGONG_CONFIG, elevation: 200 });

  test("sunrise earlier at higher elevation", () => {
    if (base.sunrise.kind !== "valid" || elevated.sunrise.kind !== "valid") {
      throw new Error("Expected valid");
    }
    expect(elevated.sunrise.ms).toBeLessThan(base.sunrise.ms);
  });

  test("sunset later at higher elevation", () => {
    if (base.sunset.kind !== "valid" || elevated.sunset.kind !== "valid") {
      throw new Error("Expected valid");
    }
    expect(elevated.sunset.ms).toBeGreaterThan(base.sunset.ms);
  });
});

// ============================================================
// L — formatLocal
// ============================================================

describe("L — formatLocal", () => {
  const ms = Date.UTC(2026, 1, 25, 12, 30, 0);

  test("returns HH:MM for Asia/Riyadh", () => {
    expect(formatLocal(ms, "Asia/Riyadh")).toMatch(/^\d{2}:\d{2}$/);
  });

  test("returns HH:MM for Europe/London", () => {
    expect(formatLocal(ms, "Europe/London")).toMatch(/^\d{2}:\d{2}$/);
  });

  test("returns HH:MM for America/New_York", () => {
    expect(formatLocal(ms, "America/New_York")).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ============================================================
// M — computeQibla
// ============================================================

describe("M — computeQibla", () => {
  test("returns a number for any location", () => {
    expect(typeof computeQibla(21.4225, 39.8262)).toBe("number");
  });

  test("London qibla is between 100° and 120°", () => {
    const q = computeQibla(51.5074, -0.1278);
    expect(q).toBeGreaterThan(100);
    expect(q).toBeLessThan(120);
  });

  test("New York qibla is between 50° and 70°", () => {
    const q = computeQibla(40.7128, -74.006);
    expect(q).toBeGreaterThan(50);
    expect(q).toBeLessThan(70);
  });

  test("Sydney qibla is between 270° and 295° (west-northwest)", () => {
    const q = computeQibla(-33.8688, 151.2093);
    expect(q).toBeGreaterThan(270);
    expect(q).toBeLessThan(295);
  });
});

// ============================================================
// N — computeSunnahTimes
// ============================================================

describe("N — computeSunnahTimes", () => {
  const meccaResult = computePrayerTimes(MECCA_CONFIG);
  const nextDayResult = computePrayerTimes({
    ...MECCA_CONFIG,
    date: MECCA_CONFIG.date + 86_400_000,
  });

  test("returns middleOfTheNight and lastThirdOfTheNight", () => {
    if (
      meccaResult.sunset.kind !== "valid" ||
      nextDayResult.fajr.kind !== "valid"
    ) {
      throw new Error("Expected valid");
    }
    const s = computeSunnahTimes(meccaResult.sunset.ms, nextDayResult.fajr.ms);
    expect(typeof s.middleOfTheNight).toBe("number");
    expect(typeof s.lastThirdOfTheNight).toBe("number");
  });

  test("middleOfTheNight < lastThirdOfTheNight", () => {
    if (
      meccaResult.sunset.kind !== "valid" ||
      nextDayResult.fajr.kind !== "valid"
    ) {
      throw new Error("Expected valid");
    }
    const s = computeSunnahTimes(meccaResult.sunset.ms, nextDayResult.fajr.ms);
    expect(s.middleOfTheNight).toBeLessThan(s.lastThirdOfTheNight);
  });

  test("both ms values are between sunset and next fajr", () => {
    if (
      meccaResult.sunset.kind !== "valid" ||
      nextDayResult.fajr.kind !== "valid"
    ) {
      throw new Error("Expected valid");
    }
    const sunsetMs = meccaResult.sunset.ms;
    const nextFajrMs = nextDayResult.fajr.ms;
    const s = computeSunnahTimes(sunsetMs, nextFajrMs);
    expect(s.middleOfTheNight).toBeGreaterThan(sunsetMs);
    expect(s.middleOfTheNight).toBeLessThan(nextFajrMs);
    expect(s.lastThirdOfTheNight).toBeGreaterThan(sunsetMs);
    expect(s.lastThirdOfTheNight).toBeLessThan(nextFajrMs);
  });
});

// ============================================================
// O — timeForPrayer / currentPrayer / nextPrayer
// ============================================================

describe("O — timeForPrayer / currentPrayer / nextPrayer", () => {
  const result = computePrayerTimes(MECCA_CONFIG);

  test("timeForPrayer('fajr') returns fajr.ms (number)", () => {
    if (result.fajr.kind !== "valid") throw new Error("Expected valid fajr");
    expect(timeForPrayer(result, "fajr")).toBe(result.fajr.ms);
  });

  test("timeForPrayer('none') returns null", () => {
    expect(timeForPrayer(result, "none")).toBeNull();
  });

  test("currentPrayer at dhuhr+1ms returns 'dhuhr'", () => {
    if (result.dhuhr.kind !== "valid") throw new Error("Expected valid dhuhr");
    expect(currentPrayer(result, result.dhuhr.ms + 1)).toBe("dhuhr");
  });

  test("nextPrayer at dhuhr+1ms returns 'asr'", () => {
    if (result.dhuhr.kind !== "valid") throw new Error("Expected valid dhuhr");
    expect(nextPrayer(result, result.dhuhr.ms + 1)).toBe("asr");
  });
});

// ============================================================
// P — recommendedHighLatRule
// ============================================================

describe("P — recommendedHighLatRule", () => {
  test("lat ≤ 48° → middle_of_night", () => {
    expect(recommendedHighLatRule(21.4225)).toBe("middle_of_night");
  });

  test("lat > 48° → seventh_of_night", () => {
    expect(recommendedHighLatRule(51.5)).toBe("seventh_of_night");
  });
});

// ============================================================
// Q — Solar functions (smoke tests)
// ============================================================

describe("Q — Solar functions", () => {
  // toJulianDate(year, month, day) — Jan 1.5 2000 = J2000.0
  const J2000 = 2451545.0;

  test("toJulianDate(2000, 1, 1.5) ≈ 2451545.0", () => {
    const jd = toJulianDate(2000, 1, 1.5);
    expect(Math.abs(jd - J2000)).toBeLessThan(0.001);
  });

  test("toJulianCentury(J2000) === 0.0", () => {
    expect(toJulianCentury(J2000)).toBe(0.0);
  });

  test("solarPosition returns finite declination and rightAscension", () => {
    const sp = solarPosition(J2000);
    expect(Number.isFinite(sp.declination)).toBe(true);
    expect(Number.isFinite(sp.rightAscension)).toBe(true);
  });

  test("meanSolarLongitude(0) is finite", () => {
    expect(Number.isFinite(meanSolarLongitude(0))).toBe(true);
  });

  test("meanSolarAnomaly(0) is finite", () => {
    expect(Number.isFinite(meanSolarAnomaly(0))).toBe(true);
  });

  test("solarEquationOfTheCenter(T=0, M=0) is finite", () => {
    expect(Number.isFinite(solarEquationOfTheCenter(0, 0))).toBe(true);
  });

  test("apparentSolarLongitude(T=0, L0=0) is finite", () => {
    expect(Number.isFinite(apparentSolarLongitude(0, 0))).toBe(true);
  });

  test("meanObliquityOfTheEcliptic(0) is finite", () => {
    expect(Number.isFinite(meanObliquityOfTheEcliptic(0))).toBe(true);
  });

  test("apparentObliquityOfTheEcliptic(T=0, eps0=23.44) is finite", () => {
    expect(Number.isFinite(apparentObliquityOfTheEcliptic(0, 23.44))).toBe(
      true,
    );
  });
});

// ============================================================
// R — Date utilities (smoke tests)
// ============================================================

describe("R — Date utilities", () => {
  test("isLeapYear(2000) === true", () => expect(isLeapYear(2000)).toBe(true));
  test("isLeapYear(1900) === false", () =>
    expect(isLeapYear(1900)).toBe(false));
  test("isLeapYear(2024) === true", () => expect(isLeapYear(2024)).toBe(true));
  test("isLeapYear(2026) === false", () =>
    expect(isLeapYear(2026)).toBe(false));

  test("dayOfYear Jan 1 === 1", () => {
    expect(dayOfYear(new Date(Date.UTC(2026, 0, 1)))).toBe(1);
  });

  test("dayOfYear Dec 31 === 365 (non-leap)", () => {
    expect(dayOfYear(new Date(Date.UTC(2026, 11, 31)))).toBe(365);
  });

  test("dateByAddingDays adds 1 day", () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    const d2 = dateByAddingDays(d, 1);
    expect(d2.getUTCDate()).toBe(2);
    expect(d2.getUTCMonth()).toBe(0);
    expect(d2.getUTCFullYear()).toBe(2026);
  });

  test("decomposeHours(5.5) → {hours:5, minutes:30, seconds:0}", () => {
    const r = decomposeHours(5.5);
    expect(r.hours).toBe(5);
    expect(r.minutes).toBe(30);
    expect(r.seconds).toBe(0);
  });

  test("roundedMinute removes sub-minute precision", () => {
    const d = new Date(Date.UTC(2026, 0, 1, 12, 30, 45));
    const rounded = roundedMinute(d, "nearest");
    expect(rounded.getUTCSeconds()).toBe(0);
  });
});

// ============================================================
// S — clearSolarCache (no crash)
// ============================================================

describe("S — clearSolarCache", () => {
  test("clearSolarCache does not throw", () => {
    expect(() => clearSolarCache()).not.toThrow();
  });

  test("computePrayerTimes still works after clearSolarCache", () => {
    clearSolarCache();
    const result = computePrayerTimes(MECCA_CONFIG);
    expect(result.fajr.kind).toBe("valid");
  });
});

// ============================================================
// T — Trig helpers (spot checks)
// ============================================================

describe("T — Trig helpers", () => {
  test("sinDeg(90) ≈ 1", () => expect(sinDeg(90)).toBeCloseTo(1, 10));
  test("cosDeg(0) ≈ 1", () => expect(cosDeg(0)).toBeCloseTo(1, 10));
  test("tanDeg(45) ≈ 1", () => expect(tanDeg(45)).toBeCloseTo(1, 10));
  test("normalizeDeg(370) ≈ 10", () =>
    expect(normalizeDeg(370)).toBeCloseTo(10, 10));
  test("asinDeg(1) ≈ 90", () => expect(asinDeg(1)).toBeCloseTo(90, 10));
  test("atan2Deg(1, 1) ≈ 45", () => expect(atan2Deg(1, 1)).toBeCloseTo(45, 10));
});
