import { test, expect, describe } from "bun:test";
import { normalizeDeg } from "../../src/units.ts";
import { normalizeToScale, quadrantShiftAngle } from "../../src/hour-angle.ts";
import {
  decomposeHours,
  roundedMinute,
  dateByAddingDays,
} from "../../src/date-utils.ts";
import type { Rounding } from "../../src/schema.ts";

// ============================================================
// Math utility tests
// ============================================================

describe("degreesToRadians / radiansToDegrees round-trips", () => {
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  test("0° → 0 radians", () => {
    expect(0 * DEG2RAD).toBe(0);
  });

  test("90° → π/2", () => {
    expect(90 * DEG2RAD).toBeCloseTo(Math.PI / 2, 10);
  });

  test("π → 180°", () => {
    expect(Math.PI * RAD2DEG).toBeCloseTo(180, 10);
  });

  test("round-trip", () => {
    expect(45 * DEG2RAD * RAD2DEG).toBeCloseTo(45, 10);
  });
});

describe("normalizeToScale", () => {
  const cases: [number, number, number][] = [
    [2.0, 1, 0],
    [-1, 1, 0],
    [-1, 24, 23],
    [1, 24, 1],
    [0, 24, 0],
    [36, 24, 12],
    [-48, 24, 0],
    [-45, 24, 3],
    [361, 360, 1],
    [360, 360, 0],
    [259, 360, 259],
  ];

  for (const [num, max, expected] of cases) {
    test(`(${num}, ${max}) = ${expected}`, () => {
      expect(normalizeToScale(num, max)).toBeCloseTo(expected, 8);
    });
  }
});

describe("unwindAngle (normalizeDeg)", () => {
  const cases: [number, number][] = [
    [-45, 315],
    [361, 1],
    [360, 0],
    [259, 259],
    [2592, 72],
  ];

  for (const [input, expected] of cases) {
    test(`${input} → ${expected}`, () => {
      expect(normalizeDeg(input)).toBeCloseTo(expected, 8);
    });
  }
});

describe("quadrantShiftAngle", () => {
  const cases: [number, number][] = [
    [360, 0],
    [361, 1],
    [1, 1],
    [-1, -1],
    [0, 0],
    [-181, 179],
    [180, 180],
    [-180, -180],
    [359, -1],
    [-359, 1],
  ];

  for (const [input, expected] of cases) {
    test(`${input} → ${expected}`, () => {
      expect(quadrantShiftAngle(input)).toBeCloseTo(expected, 8);
    });
  }
});

describe("decomposeHours (TimeComponents)", () => {
  test("15.199", () => {
    const tc = decomposeHours(15.199);
    expect(tc.hours).toBe(15);
    expect(tc.minutes).toBe(11);
    expect(tc.seconds).toBe(56);
  });

  test("1.0084", () => {
    const tc = decomposeHours(1.0084);
    expect(tc.hours).toBe(1);
    expect(tc.minutes).toBe(0);
    expect(tc.seconds).toBe(30);
  });

  test("1.0083", () => {
    const tc = decomposeHours(1.0083);
    expect(tc.hours).toBe(1);
    expect(tc.minutes).toBe(0);
    // seconds may be 29 or 30 due to floating point
    expect(tc.seconds).toBeGreaterThanOrEqual(29);
    expect(tc.seconds).toBeLessThanOrEqual(30);
  });

  test("2.1", () => {
    const tc = decomposeHours(2.1);
    expect(tc.hours).toBe(2);
    expect(tc.minutes).toBe(6);
    expect(tc.seconds).toBe(0);
  });

  test("3.5", () => {
    const tc = decomposeHours(3.5);
    expect(tc.hours).toBe(3);
    expect(tc.minutes).toBe(30);
    expect(tc.seconds).toBe(0);
  });
});

describe("roundedMinute", () => {
  test("nearest — round down", () => {
    const date = new Date(Date.UTC(2015, 0, 1, 10, 30, 15));
    const rounded = roundedMinute(date, "nearest" as Rounding);
    expect(rounded.getUTCMinutes()).toBe(30);
    expect(rounded.getUTCSeconds()).toBe(0);
  });

  test("nearest — round up", () => {
    const date = new Date(Date.UTC(2015, 0, 1, 10, 30, 45));
    const rounded = roundedMinute(date, "nearest" as Rounding);
    expect(rounded.getUTCMinutes()).toBe(31);
    expect(rounded.getUTCSeconds()).toBe(0);
  });

  test("up — always round up", () => {
    const date = new Date(Date.UTC(2015, 0, 1, 10, 30, 15));
    const rounded = roundedMinute(date, "up" as Rounding);
    expect(rounded.getUTCMinutes()).toBe(31);
    expect(rounded.getUTCSeconds()).toBe(0);
  });

  test("none — no rounding", () => {
    const date = new Date(Date.UTC(2015, 0, 1, 10, 30, 45));
    const rounded = roundedMinute(date, "none" as Rounding);
    expect(rounded.getUTCSeconds()).toBe(45);
  });

  test("nearest — exact minute", () => {
    const date = new Date(Date.UTC(2015, 0, 1, 10, 30, 0));
    const rounded = roundedMinute(date, "nearest" as Rounding);
    expect(rounded.getUTCMinutes()).toBe(30);
    expect(rounded.getUTCSeconds()).toBe(0);
  });
});

describe("dateByAddingDays", () => {
  test("add 1 day", () => {
    const date = new Date(2015, 0, 1);
    const result = dateByAddingDays(date, 1);
    expect(result.getDate()).toBe(2);
  });

  test("add -1 day", () => {
    const date = new Date(2015, 0, 2);
    const result = dateByAddingDays(date, -1);
    expect(result.getDate()).toBe(1);
  });
});
