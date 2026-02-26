import { test, expect, describe } from "bun:test";
import { applyHighLatFallback } from "../../src/high-latitude.ts";
import type { HighLatRule } from "../../src/schema.ts";
import { HighLatRule as HighLatRuleSchema } from "../../src/schema.ts";
import type { PrayerTimeResult } from "../../src/prayers.ts";

function makeUndefined(
  cosOmega: number,
): PrayerTimeResult & { kind: "undefined" } {
  return {
    kind: "undefined",
    reason: "test",
    diagnostics: {
      cosOmega,
      clamped: false,
      fallbackUsed: null,
      targetAltitude: -18,
    },
  };
}

// 10-hour night: sunset at 20:00 UTC, sunrise at 06:00 UTC next day
const sunsetMs = new Date("2026-06-21T20:00:00Z").getTime();
const sunriseMs = new Date("2026-06-22T06:00:00Z").getTime();
const nightMs = sunriseMs - sunsetMs; // 10 hours

describe("applyHighLatFallback", () => {
  test("middle_of_night returns night midpoint for both sides", () => {
    const original = makeUndefined(1.5);
    const rule = HighLatRuleSchema.assert("middle_of_night");
    const resultFajr = applyHighLatFallback(
      original,
      rule,
      sunsetMs,
      sunriseMs,
      18,
      "fajr",
    );
    const resultIsha = applyHighLatFallback(
      original,
      rule,
      sunsetMs,
      sunriseMs,
      18,
      "isha",
    );

    expect(resultFajr.kind).toBe("valid");
    expect(resultIsha.kind).toBe("valid");
    if (resultFajr.kind === "valid" && resultIsha.kind === "valid") {
      const expectedMs = sunsetMs + nightMs / 2;
      expect(resultFajr.ms).toBe(expectedMs);
      expect(resultIsha.ms).toBe(expectedMs);
      expect(resultFajr.diagnostics.fallbackUsed).toBe("middle_of_night");
    }
  });

  test("seventh_of_night: isha = sunset + 1/7, fajr = sunrise - 1/7", () => {
    const original = makeUndefined(1.5);
    const rule = HighLatRuleSchema.assert("seventh_of_night");
    const resultIsha = applyHighLatFallback(
      original,
      rule,
      sunsetMs,
      sunriseMs,
      18,
      "isha",
    );
    const resultFajr = applyHighLatFallback(
      original,
      rule,
      sunsetMs,
      sunriseMs,
      18,
      "fajr",
    );

    expect(resultIsha.kind).toBe("valid");
    expect(resultFajr.kind).toBe("valid");
    if (resultIsha.kind === "valid" && resultFajr.kind === "valid") {
      const seventhMs = nightMs / 7;
      expect(resultIsha.ms).toBeCloseTo(sunsetMs + seventhMs, -1);
      expect(resultFajr.ms).toBeCloseTo(sunriseMs - seventhMs, -1);
      expect(resultIsha.diagnostics.fallbackUsed).toBe("seventh_of_night");
    }
  });

  test("twilight_angle: portion = angle/60 of night", () => {
    const original = makeUndefined(1.5);
    const rule = HighLatRuleSchema.assert("twilight_angle");
    const resultIsha = applyHighLatFallback(
      original,
      rule,
      sunsetMs,
      sunriseMs,
      18,
      "isha",
    );
    const resultFajr = applyHighLatFallback(
      original,
      rule,
      sunsetMs,
      sunriseMs,
      18,
      "fajr",
    );

    expect(resultIsha.kind).toBe("valid");
    expect(resultFajr.kind).toBe("valid");
    if (resultIsha.kind === "valid" && resultFajr.kind === "valid") {
      const offsetMs = (18 / 60) * nightMs;
      expect(resultIsha.ms).toBe(sunsetMs + offsetMs);
      expect(resultFajr.ms).toBe(sunriseMs - offsetMs);
      expect(resultIsha.diagnostics.fallbackUsed).toBe("twilight_angle");
    }
  });

  test("None rule returns original undefined", () => {
    const original = makeUndefined(1.5);
    const rule = HighLatRuleSchema.assert("none");
    const result = applyHighLatFallback(
      original,
      rule,
      sunsetMs,
      sunriseMs,
      18,
      "isha",
    );
    expect(result.kind).toBe("undefined");
  });

  test("zero night duration (midnight sun) returns original", () => {
    const original = makeUndefined(1.5);
    const sameTimeMs = new Date("2026-06-21T20:00:00Z").getTime();
    const rule = HighLatRuleSchema.assert("middle_of_night");
    const result = applyHighLatFallback(
      original,
      rule,
      sameTimeMs,
      sameTimeMs,
      18,
      "isha",
    );
    expect(result.kind).toBe("undefined");
  });
});
