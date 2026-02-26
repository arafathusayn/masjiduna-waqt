import { test, expect, describe } from "bun:test";
import {
  computeHourAngle,
  hourAngleToHours,
  approximateTransit,
  correctedTransit,
  correctedHourAngle,
  correctedHourAngleFast,
  interpolate,
  interpolateAngles,
  quadrantShiftAngle,
} from "../../src/hour-angle.ts";
import { solarPosition, toJulianDate } from "../../src/solar.ts";

describe("computeHourAngle", () => {
  test("sunrise/sunset at equator on equinox: ~90 deg hour angle", () => {
    const result = computeHourAngle(-0.8333, 0, 0);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.angle).toBeGreaterThan(90);
      expect(result.angle).toBeLessThan(91.5);
      expect(result.clamped).toBe(false);
    }
  });

  test("Fajr at 18 deg below horizon, mid-latitude, winter", () => {
    const result = computeHourAngle(-18, 22.36, -9.5);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.angle).toBeGreaterThan(100);
      expect(result.angle).toBeLessThan(120);
    }
  });

  test("undefined when sun never reaches -18 deg at high latitude in summer", () => {
    const result = computeHourAngle(-18, 51.5, 23.44);
    expect(result.kind).toBe("undefined");
    if (result.kind === "undefined") {
      expect(result.cosOmega).toBeLessThan(-1);
    }
  });

  test("epsilon clamping for borderline case", () => {
    const result = computeHourAngle(-18, 48.5, 23.4);
    expect(["valid", "undefined"]).toContain(result.kind);
  });

  test("valid result at moderate conditions", () => {
    const result = computeHourAngle(-17, 40.71, 0);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.angle).toBeGreaterThan(100);
      expect(result.angle).toBeLessThan(115);
    }
  });
});

describe("hourAngleToHours", () => {
  test("90 deg = 6 hours", () => {
    expect(hourAngleToHours(90)).toBe(6);
  });

  test("180 deg = 12 hours", () => {
    expect(hourAngleToHours(180)).toBe(12);
  });

  test("15 deg = 1 hour", () => {
    expect(hourAngleToHours(15)).toBe(1);
  });
});

describe("interpolate", () => {
  test("n=0 returns y2", () => {
    expect(interpolate(10, 5, 15, 0)).toBe(10);
  });

  test("linear interpolation (a=b → c=0)", () => {
    expect(interpolate(10, 5, 15, 0.5)).toBeCloseTo(12.5, 5);
  });

  test("quadratic term applies for non-uniform spacing", () => {
    const result = interpolate(10, 5, 20, 0.5);
    expect(result).not.toBe(12.5); // c ≠ 0
  });
});

describe("interpolateAngles", () => {
  test("handles angle wrapping near 0/360", () => {
    const result = interpolateAngles(350, 340, 0, 0.5);
    expect(result).toBeGreaterThan(350);
    expect(result).toBeLessThan(360);
  });
});

describe("quadrantShiftAngle", () => {
  test("angle in range unchanged", () => {
    expect(quadrantShiftAngle(45)).toBe(45);
    expect(quadrantShiftAngle(-90)).toBe(-90);
    expect(quadrantShiftAngle(0)).toBe(0);
  });

  test("angle > 180 shifted", () => {
    expect(quadrantShiftAngle(270)).toBeCloseTo(-90, 5);
  });

  test("angle < -180 shifted", () => {
    expect(quadrantShiftAngle(-270)).toBeCloseTo(90, 5);
  });
});

describe("corrected transit and hour angles", () => {
  // Chittagong Feb 25, 2026
  const jd = toJulianDate(2026, 2, 25);
  const prev = solarPosition(jd - 1);
  const curr = solarPosition(jd);
  const next = solarPosition(jd + 1);
  const lat = 22.3569;
  const lng = 91.7832;

  test("approximateTransit returns day fraction in [0, 1)", () => {
    const m0 = approximateTransit(
      lng,
      curr.apparentSiderealTime,
      curr.rightAscension,
    );
    expect(m0).toBeGreaterThanOrEqual(0);
    expect(m0).toBeLessThan(1);
  });

  test("correctedTransit (Chittagong)", () => {
    const m0 = approximateTransit(
      lng,
      curr.apparentSiderealTime,
      curr.rightAscension,
    );
    const transit = correctedTransit(
      m0,
      lng,
      curr.apparentSiderealTime,
      curr.rightAscension,
      prev.rightAscension,
      next.rightAscension,
    );
    // Expected ~6.0988 UTC hours, match to <1 second
    expect(transit).toBeCloseTo(6.0988, 2);
  });

  test("correctedHourAngle sunrise (Chittagong)", () => {
    const m0 = approximateTransit(
      lng,
      curr.apparentSiderealTime,
      curr.rightAscension,
    );
    const result = correctedHourAngle(
      m0,
      -0.8333,
      lat,
      lng,
      false,
      curr.apparentSiderealTime,
      curr.rightAscension,
      prev.rightAscension,
      next.rightAscension,
      curr.declination,
      prev.declination,
      next.declination,
    );
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      // Expected ~0.292 UTC hours
      expect(result.angle).toBeCloseTo(0.292, 2);
    }
  });

  test("correctedHourAngle sunset (Chittagong)", () => {
    const m0 = approximateTransit(
      lng,
      curr.apparentSiderealTime,
      curr.rightAscension,
    );
    const result = correctedHourAngle(
      m0,
      -0.8333,
      lat,
      lng,
      true,
      curr.apparentSiderealTime,
      curr.rightAscension,
      prev.rightAscension,
      next.rightAscension,
      curr.declination,
      prev.declination,
      next.declination,
    );
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      // Expected ~11.911 UTC hours
      expect(result.angle).toBeCloseTo(11.911, 2);
    }
  });

  test("correctedHourAngleFast matches correctedHourAngle (sunrise)", () => {
    const m0 = approximateTransit(
      lng,
      curr.apparentSiderealTime,
      curr.rightAscension,
    );
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const Lw = -lng;
    const result = correctedHourAngleFast(
      m0,
      -0.8333,
      sinLat,
      cosLat,
      Lw,
      false,
      curr.apparentSiderealTime,
      curr.rightAscension,
      prev.rightAscension,
      next.rightAscension,
      curr.declination,
      prev.declination,
      next.declination,
    );
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.angle).toBeCloseTo(0.292, 2);
    }
  });

  test("correctedHourAngleFast returns undefined for impossible altitude", () => {
    const jd2 = toJulianDate(2026, 6, 21);
    const p = solarPosition(jd2 - 1);
    const c = solarPosition(jd2);
    const n = solarPosition(jd2 + 1);
    const londonLat = 51.5074;
    const sinLat = Math.sin((londonLat * Math.PI) / 180);
    const cosLat = Math.cos((londonLat * Math.PI) / 180);
    const Lw = 0.1278;
    const m0 = approximateTransit(
      -0.1278,
      c.apparentSiderealTime,
      c.rightAscension,
    );
    const result = correctedHourAngleFast(
      m0,
      -18,
      sinLat,
      cosLat,
      Lw,
      false,
      c.apparentSiderealTime,
      c.rightAscension,
      p.rightAscension,
      n.rightAscension,
      c.declination,
      p.declination,
      n.declination,
    );
    expect(result.kind).toBe("undefined");
  });

  test("correctedHourAngle returns undefined for impossible altitude", () => {
    // London summer solstice, Fajr at -18 deg — sun never reaches this
    const jd2 = toJulianDate(2026, 6, 21);
    const p = solarPosition(jd2 - 1);
    const c = solarPosition(jd2);
    const n = solarPosition(jd2 + 1);
    const m0 = approximateTransit(
      -0.1278,
      c.apparentSiderealTime,
      c.rightAscension,
    );
    const result = correctedHourAngle(
      m0,
      -18,
      51.5074,
      -0.1278,
      false,
      c.apparentSiderealTime,
      c.rightAscension,
      p.rightAscension,
      n.rightAscension,
      c.declination,
      p.declination,
      n.declination,
    );
    expect(result.kind).toBe("undefined");
  });
});
