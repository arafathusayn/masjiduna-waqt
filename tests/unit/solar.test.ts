import { test, expect, describe } from "bun:test";
import {
  toJulianDate,
  toJulianCentury,
  solarPosition,
  meanLunarLongitude,
  ascendingLunarNodeLongitude,
  nutationInLongitude,
  nutationInObliquity,
  meanSiderealTime,
} from "../../src/solar.ts";

describe("toJulianDate", () => {
  test("J2000.0 epoch: Jan 1.5, 2000 = JD 2451545.0", () => {
    expect(toJulianDate(2000, 1, 1.5)).toBeCloseTo(2451545.0, 5);
  });

  test("known date: Oct 4.81, 1957 (Sputnik) = JD 2436116.31", () => {
    expect(toJulianDate(1957, 10, 4.81)).toBeCloseTo(2436116.31, 1);
  });

  test("start of 2026: Jan 1.0 = JD 2461041.5", () => {
    expect(toJulianDate(2026, 1, 1)).toBeCloseTo(2461041.5, 1);
  });

  test("Feb 25, 2026 (test reference date)", () => {
    const jd = toJulianDate(2026, 2, 25);
    expect(jd).toBeCloseTo(2461096.5, 1);
  });
});

describe("toJulianCentury", () => {
  test("J2000.0 epoch gives T=0", () => {
    expect(toJulianCentury(2451545.0)).toBe(0);
  });

  test("one century after J2000.0", () => {
    expect(toJulianCentury(2451545.0 + 36525.0)).toBeCloseTo(1.0, 10);
  });
});

describe("solarPosition", () => {
  test("near vernal equinox (Mar 20, 2026): declination ~ 0 deg", () => {
    const jd = toJulianDate(2026, 3, 20);
    const pos = solarPosition(jd);
    expect(Math.abs(pos.declination)).toBeLessThan(1.0);
  });

  test("near summer solstice (Jun 21, 2026): declination ~ +23.4 deg", () => {
    const jd = toJulianDate(2026, 6, 21);
    const pos = solarPosition(jd);
    expect(pos.declination).toBeGreaterThan(23.0);
    expect(pos.declination).toBeLessThan(23.5);
  });

  test("near winter solstice (Dec 21, 2025): declination ~ -23.4 deg", () => {
    const jd = toJulianDate(2025, 12, 21);
    const pos = solarPosition(jd);
    expect(pos.declination).toBeLessThan(-23.0);
    expect(pos.declination).toBeGreaterThan(-23.5);
  });

  test("equation of time is in reasonable range (-17 to +14 min)", () => {
    const testDates: [number, number, number][] = [
      [2026, 1, 15],
      [2026, 4, 15],
      [2026, 7, 15],
      [2026, 10, 15],
    ];
    for (const [y, m, d] of testDates) {
      const jd = toJulianDate(y, m, d);
      const pos = solarPosition(jd);
      expect(pos.eqtMinutes).toBeGreaterThan(-17);
      expect(pos.eqtMinutes).toBeLessThan(17);
    }
  });

  test("Feb 25, 2026: EqT ~ -13 min (known value)", () => {
    const jd = toJulianDate(2026, 2, 25);
    const pos = solarPosition(jd);
    expect(pos.eqtMinutes).toBeGreaterThan(-14);
    expect(pos.eqtMinutes).toBeLessThan(-12);
  });

  test("Feb 25, 2026: declination ~ -9 to -10 deg", () => {
    const jd = toJulianDate(2026, 2, 25);
    const pos = solarPosition(jd);
    expect(pos.declination).toBeGreaterThan(-11);
    expect(pos.declination).toBeLessThan(-8);
  });

  test("Feb 25, 2026: right ascension ~ 338 deg", () => {
    const jd = toJulianDate(2026, 2, 25);
    const pos = solarPosition(jd);
    expect(pos.rightAscension).toBeCloseTo(338.148, 0);
  });

  test("Feb 25, 2026: apparent sidereal time ~ 154.87 deg", () => {
    const jd = toJulianDate(2026, 2, 25);
    const pos = solarPosition(jd);
    expect(pos.apparentSiderealTime).toBeCloseTo(154.873, 0);
  });

  test("Jun 21, 2026: right ascension ~ 89.6 deg (summer solstice)", () => {
    const jd = toJulianDate(2026, 6, 21);
    const pos = solarPosition(jd);
    expect(pos.rightAscension).toBeCloseTo(89.638, 0);
  });

  test("Jun 21, 2026: apparent sidereal time ~ 269.2 deg", () => {
    const jd = toJulianDate(2026, 6, 21);
    const pos = solarPosition(jd);
    expect(pos.apparentSiderealTime).toBeCloseTo(269.209, 0);
  });
});

describe("meanSiderealTime", () => {
  test("returns a value in [0, 360) range", () => {
    const T = toJulianCentury(toJulianDate(2026, 2, 25));
    const st = meanSiderealTime(T);
    expect(st).toBeGreaterThanOrEqual(0);
    expect(st).toBeLessThan(360);
  });
});

describe("nutation functions", () => {
  test("meanLunarLongitude returns value in [0, 360)", () => {
    const T = toJulianCentury(toJulianDate(2026, 2, 25));
    const Lp = meanLunarLongitude(T);
    expect(Lp).toBeGreaterThanOrEqual(0);
    expect(Lp).toBeLessThan(360);
  });

  test("ascendingLunarNodeLongitude returns value in [0, 360)", () => {
    const T = toJulianCentury(toJulianDate(2026, 2, 25));
    const Omega = ascendingLunarNodeLongitude(T);
    expect(Omega).toBeGreaterThanOrEqual(0);
    expect(Omega).toBeLessThan(360);
  });

  test("nutationInLongitude is small (< 0.01 deg)", () => {
    const T = toJulianCentury(toJulianDate(2026, 2, 25));
    const L0 = 280.46646 + 36000.76983 * T;
    const Lp = meanLunarLongitude(T);
    const Omega = ascendingLunarNodeLongitude(T);
    const dPsi = nutationInLongitude(L0, Lp, Omega);
    expect(Math.abs(dPsi)).toBeLessThan(0.01);
  });

  test("nutationInObliquity is small (< 0.01 deg)", () => {
    const T = toJulianCentury(toJulianDate(2026, 2, 25));
    const L0 = 280.46646 + 36000.76983 * T;
    const Lp = meanLunarLongitude(T);
    const Omega = ascendingLunarNodeLongitude(T);
    const dEps = nutationInObliquity(L0, Lp, Omega);
    expect(Math.abs(dEps)).toBeLessThan(0.01);
  });
});
