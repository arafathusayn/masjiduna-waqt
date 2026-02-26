import { test, expect, describe } from "bun:test";
import {
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
} from "../../src/solar.ts";
import {
  altitudeOfCelestialBody,
  approximateTransit,
  correctedTransit,
  correctedHourAngle,
  interpolate,
  interpolateAngles,
  normalizeToScale,
} from "../../src/hour-angle.ts";

// ============================================================
// Astronomical functions — exact Meeus values
// ============================================================

describe("Solar coordinates for 1992-10-13", () => {
  // Reference: Meeus "Astronomical Algorithms" example
  const jd = toJulianDate(1992, 10, 13);
  const T = toJulianCentury(jd);

  test("Julian century", () => {
    expect(T).toBeCloseTo(-0.072183436, 7);
  });

  test("mean solar longitude", () => {
    const L0 = meanSolarLongitude(T);
    expect(L0).toBeCloseTo(201.8072, 4);
  });

  test("mean solar anomaly", () => {
    const M = meanSolarAnomaly(T);
    expect(M).toBeCloseTo(278.99397, 4);
  });

  test("solar equation of the center", () => {
    const M = meanSolarAnomaly(T);
    const C = solarEquationOfTheCenter(T, M);
    expect(C).toBeCloseTo(-1.89732, 4);
  });

  test("apparent solar longitude", () => {
    const L0 = meanSolarLongitude(T);
    const lambda = apparentSolarLongitude(T, L0);
    expect(lambda).toBeCloseTo(199.90895, 4);
  });

  test("mean obliquity of ecliptic", () => {
    const eps0 = meanObliquityOfTheEcliptic(T);
    expect(eps0).toBeCloseTo(23.44023, 4);
  });

  test("apparent obliquity of ecliptic", () => {
    const eps0 = meanObliquityOfTheEcliptic(T);
    const epsApp = apparentObliquityOfTheEcliptic(T, eps0);
    expect(epsApp).toBeCloseTo(23.43999, 4);
  });

  test("declination", () => {
    const sp = solarPosition(jd);
    expect(sp.declination).toBeCloseTo(-7.78507, 4);
  });

  test("right ascension", () => {
    const sp = solarPosition(jd);
    expect(sp.rightAscension).toBeCloseTo(198.38083, 4);
  });
});

describe("Sidereal time for 1987-04-10", () => {
  const jd = toJulianDate(1987, 4, 10);
  const T = toJulianCentury(jd);

  test("mean sidereal time", () => {
    const Theta0 = meanSiderealTime(T);
    expect(Theta0).toBeCloseTo(197.693195, 4);
  });
});

describe("Nutation", () => {
  // Test nutation at a known date
  const jd = toJulianDate(1992, 10, 13);
  const T = toJulianCentury(jd);
  const L0 = meanSolarLongitude(T);
  const Lp = meanLunarLongitude(T);
  const Omega = ascendingLunarNodeLongitude(T);

  test("nutation in longitude is small", () => {
    const dPsi = nutationInLongitude(L0, Lp, Omega);
    // Nutation in longitude is typically ±0.01°
    expect(Math.abs(dPsi)).toBeLessThan(0.02);
  });

  test("nutation in obliquity is small", () => {
    const dEps = nutationInObliquity(L0, Lp, Omega);
    expect(Math.abs(dEps)).toBeLessThan(0.01);
  });
});

describe("Altitude of celestial body", () => {
  test("Meeus example", () => {
    // φ=38.9216°, δ=-6.7199°, H=64.352133° → h≈15.1249°
    const h = altitudeOfCelestialBody(38.9216, -6.7199, 64.352133);
    expect(h).toBeCloseTo(15.1249, 3);
  });
});

describe("Transit and hour angle — Meeus p.103", () => {
  // Longitude -71.0833 (West)
  const lng = -71.0833;

  test("approximate transit", () => {
    // Using known RA and sidereal time values
    const sp = solarPosition(toJulianDate(1988, 3, 20));
    const m0 = approximateTransit(
      lng,
      sp.apparentSiderealTime,
      sp.rightAscension,
    );
    expect(m0).toBeGreaterThan(0);
    expect(m0).toBeLessThan(1);
  });
});

describe("Julian day", () => {
  const testCases: [number, number, number, number][] = [
    [2010, 1, 2, 2455198.5],
    [2011, 2, 4, 2455596.5],
    [2012, 3, 6, 2455992.5],
    [2013, 4, 8, 2456390.5],
    [2014, 5, 10, 2456787.5],
    [2015, 6, 12, 2457185.5],
    [2016, 7, 14, 2457583.5],
    [2017, 8, 16, 2457981.5],
    [2018, 9, 18, 2458379.5],
    [2019, 10, 20, 2458776.5],
    [2020, 11, 22, 2459175.5],
    [2021, 12, 24, 2459572.5],
  ];

  for (const [y, m, d, expected] of testCases) {
    test(`${y}-${m}-${d}`, () => {
      expect(toJulianDate(y, m, d)).toBeCloseTo(expected, 1);
    });
  }
});

describe("Interpolation", () => {
  test("interpolate — Meeus example", () => {
    // Our interpolate(y2, y1, y3, n): y2=central, y1=prev, y3=next
    // Meeus p.24: y1=0.884226, y2=0.877366, y3=0.870531, n=4.35/24≈0.18125
    // With n=0.18125: a = y2-y1 = -0.00686, b = y3-y2 = -0.006835, c = b-a = -0.000025
    const result = interpolate(0.877366, 0.884226, 0.870531, 0.18125);
    // Expected ≈ 0.876125
    expect(result).toBeCloseTo(0.87613, 4);
  });

  test("interpolateAngles wraps correctly", () => {
    // Known RA values crossing 360° boundary
    const result = interpolateAngles(1, 359, 3, 0.5);
    // Should interpolate smoothly, not jump 358°
    expect(result).toBeCloseTo(2, 0);
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
    test(`normalizeToScale(${num}, ${max}) = ${expected}`, () => {
      expect(normalizeToScale(num, max)).toBeCloseTo(expected, 8);
    });
  }
});

describe("Right ascension edge case — 366 consecutive days", () => {
  test("transit, sunrise, sunset diffs are within threshold", () => {
    const coords = { lat: 35.7796, lng: -78.6382 };
    let prevTransit: number | null = null;
    let prevSunrise: number | null = null;
    let prevSunset: number | null = null;

    for (let i = 0; i < 366; i++) {
      const date = new Date(2015, 0, 1 + i);
      const jd = toJulianDate(
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
      );
      const solar = solarPosition(jd);
      const prevSolar = solarPosition(jd - 1);
      const nextSolar = solarPosition(jd + 1);

      const m0 = approximateTransit(
        coords.lng,
        solar.apparentSiderealTime,
        solar.rightAscension,
      );
      const transit = correctedTransit(
        m0,
        coords.lng,
        solar.apparentSiderealTime,
        solar.rightAscension,
        prevSolar.rightAscension,
        nextSolar.rightAscension,
      );

      const sunriseHA = correctedHourAngle(
        m0,
        -0.8333,
        coords.lat,
        coords.lng,
        false,
        solar.apparentSiderealTime,
        solar.rightAscension,
        prevSolar.rightAscension,
        nextSolar.rightAscension,
        solar.declination,
        prevSolar.declination,
        nextSolar.declination,
      );
      const sunsetHA = correctedHourAngle(
        m0,
        -0.8333,
        coords.lat,
        coords.lng,
        true,
        solar.apparentSiderealTime,
        solar.rightAscension,
        prevSolar.rightAscension,
        nextSolar.rightAscension,
        solar.declination,
        prevSolar.declination,
        nextSolar.declination,
      );

      if (prevTransit !== null) {
        expect(Math.abs(transit - prevTransit)).toBeLessThan(1 / 60); // < 1 minute
      }
      if (sunriseHA.kind === "valid" && prevSunrise !== null) {
        expect(Math.abs(sunriseHA.angle - prevSunrise)).toBeLessThan(2 / 60); // < 2 minutes
      }
      if (sunsetHA.kind === "valid" && prevSunset !== null) {
        expect(Math.abs(sunsetHA.angle - prevSunset)).toBeLessThan(2 / 60);
      }

      prevTransit = transit;
      prevSunrise = sunriseHA.kind === "valid" ? sunriseHA.angle : prevSunrise;
      prevSunset = sunsetHA.kind === "valid" ? sunsetHA.angle : prevSunset;
    }
  });
});
