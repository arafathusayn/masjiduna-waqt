import { test, expect, describe } from "bun:test";
import {
  seasonAdjustedMorningTwilight,
  seasonAdjustedEveningTwilight,
} from "../../src/moonsighting.ts";
import { dayOfYear } from "../../src/date-utils.ts";
import type { Shafaq } from "../../src/schema.ts";

// ============================================================
// MoonsightingCommittee seasonal twilight tests.
// ============================================================

describe("seasonAdjustedMorningTwilight", () => {
  test("northern moderate latitude — winter", () => {
    const sunriseMs = new Date(Date.UTC(2016, 0, 15, 7, 0, 0)).getTime();
    const result = seasonAdjustedMorningTwilight(35, 15, 2016, sunriseMs);
    expect(result).toBeLessThan(sunriseMs);
    const diffMin = (sunriseMs - result) / 60000;
    expect(diffMin).toBeGreaterThan(60);
    expect(diffMin).toBeLessThan(150);
  });

  test("northern high latitude — summer", () => {
    const sunriseMs = new Date(Date.UTC(2016, 6, 1, 3, 30, 0)).getTime();
    const result = seasonAdjustedMorningTwilight(55, 182, 2016, sunriseMs);
    expect(result).toBeLessThan(sunriseMs);
    const diffMin = (sunriseMs - result) / 60000;
    expect(diffMin).toBeGreaterThan(60);
    expect(diffMin).toBeLessThan(180);
  });

  test("equator — ~75 minutes year-round", () => {
    const sunriseMs = new Date(Date.UTC(2016, 0, 15, 6, 0, 0)).getTime();
    const result = seasonAdjustedMorningTwilight(0, 15, 2016, sunriseMs);
    const diffMin = (sunriseMs - result) / 60000;
    expect(diffMin).toBeCloseTo(75, -1);
  });

  test("symmetry — winter and summer are consistent", () => {
    const sunrise1Ms = new Date(Date.UTC(2016, 0, 15, 7, 0, 0)).getTime();
    const sunrise2Ms = new Date(Date.UTC(2016, 6, 15, 5, 0, 0)).getTime();
    const winter = seasonAdjustedMorningTwilight(40, 15, 2016, sunrise1Ms);
    const summer = seasonAdjustedMorningTwilight(40, 197, 2016, sunrise2Ms);
    const winterDiff = (sunrise1Ms - winter) / 60000;
    const summerDiff = (sunrise2Ms - summer) / 60000;
    // Both should be reasonable twilight durations
    expect(winterDiff).toBeGreaterThan(60);
    expect(summerDiff).toBeGreaterThan(60);
  });
});

describe("seasonAdjustedEveningTwilight", () => {
  test("general shafaq", () => {
    const sunsetMs = new Date(Date.UTC(2016, 0, 15, 17, 0, 0)).getTime();
    const result = seasonAdjustedEveningTwilight(
      35,
      15,
      2016,
      sunsetMs,
      "general" as Shafaq,
    );
    expect(result).toBeGreaterThan(sunsetMs);
    const diffMin = (result - sunsetMs) / 60000;
    expect(diffMin).toBeGreaterThan(60);
    expect(diffMin).toBeLessThan(150);
  });

  test("ahmer shafaq — shorter twilight", () => {
    const sunsetMs = new Date(Date.UTC(2016, 0, 15, 17, 0, 0)).getTime();
    const result = seasonAdjustedEveningTwilight(
      35,
      15,
      2016,
      sunsetMs,
      "ahmer" as Shafaq,
    );
    expect(result).toBeGreaterThan(sunsetMs);
    const diffMin = (result - sunsetMs) / 60000;
    expect(diffMin).toBeGreaterThan(50);
    expect(diffMin).toBeLessThan(100);
  });

  test("abyad shafaq — longer twilight", () => {
    const sunsetMs = new Date(Date.UTC(2016, 0, 15, 17, 0, 0)).getTime();
    const result = seasonAdjustedEveningTwilight(
      35,
      15,
      2016,
      sunsetMs,
      "abyad" as Shafaq,
    );
    expect(result).toBeGreaterThan(sunsetMs);
    const diffMin = (result - sunsetMs) / 60000;
    expect(diffMin).toBeGreaterThan(70);
    expect(diffMin).toBeLessThan(160);
  });

  test("ahmer <= general <= abyad", () => {
    const sunsetMs = new Date(Date.UTC(2016, 0, 15, 17, 0, 0)).getTime();
    const ahmer = seasonAdjustedEveningTwilight(
      40,
      15,
      2016,
      sunsetMs,
      "ahmer" as Shafaq,
    );
    const general = seasonAdjustedEveningTwilight(
      40,
      15,
      2016,
      sunsetMs,
      "general" as Shafaq,
    );
    const abyad = seasonAdjustedEveningTwilight(
      40,
      15,
      2016,
      sunsetMs,
      "abyad" as Shafaq,
    );
    expect(ahmer).toBeLessThanOrEqual(general);
    expect(general).toBeLessThanOrEqual(abyad);
  });
});

describe("seasonalAdjustment — all 6 piecewise segments", () => {
  // We test by choosing dates that land in each segment.
  // For northern hemisphere (lat=40): daysSinceSolstice = dayOfYear + 10.
  // Segments: [0,91), [91,137), [137,183), [183,229), [229,275), [275,366)
  const lat = 40;
  const sunriseMs = new Date(Date.UTC(2016, 0, 1, 7, 0, 0)).getTime();
  const sunsetMs = new Date(Date.UTC(2016, 0, 1, 17, 0, 0)).getTime();

  // doy that maps to dyy in each segment (dyy = doy + 10, wrapping at 366)
  const testCases: [string, number][] = [
    ["segment 0–91 (winter)", 30], // dyy=40
    ["segment 91–137 (spring1)", 100], // dyy=110
    ["segment 137–183 (spring2)", 150], // dyy=160
    ["segment 183–229 (summer)", 200], // dyy=210
    ["segment 229–275 (autumn)", 250], // dyy=260
    ["segment 275–366 (late autumn)", 300], // dyy=310
  ];

  for (const [label, doy] of testCases) {
    test(`morning twilight — ${label}`, () => {
      const result = seasonAdjustedMorningTwilight(lat, doy, 2016, sunriseMs);
      expect(result).toBeLessThan(sunriseMs);
      const diffMin = (sunriseMs - result) / 60000;
      expect(diffMin).toBeGreaterThan(50);
      expect(diffMin).toBeLessThan(200);
    });

    test(`evening twilight — ${label}`, () => {
      const result = seasonAdjustedEveningTwilight(
        lat,
        doy,
        2016,
        sunsetMs,
        "general" as Shafaq,
      );
      expect(result).toBeGreaterThan(sunsetMs);
      const diffMin = (result - sunsetMs) / 60000;
      expect(diffMin).toBeGreaterThan(50);
      expect(diffMin).toBeLessThan(200);
    });
  }
});

describe("Cross-check: morning twilight via MoonsightingCommittee", () => {
  test("high-latitude MoonsightingCommittee produces valid Fajr/Isha", () => {
    // At lat=56, MoonsightingCommittee should use seasonal adjustments
    const sunriseMs = new Date(Date.UTC(2016, 5, 21, 3, 0, 0)).getTime();
    const sunsetMs = new Date(Date.UTC(2016, 5, 21, 21, 0, 0)).getTime();
    const doy = dayOfYear(new Date(2016, 5, 21));

    const fajr = seasonAdjustedMorningTwilight(56, doy, 2016, sunriseMs);
    const isha = seasonAdjustedEveningTwilight(
      56,
      doy,
      2016,
      sunsetMs,
      "general" as Shafaq,
    );

    // Both should be valid numbers
    expect(fajr).toBeLessThan(sunriseMs);
    expect(isha).toBeGreaterThan(sunsetMs);
    // Fajr should be within 3 hours of sunrise
    expect((sunriseMs - fajr) / 3600000).toBeLessThan(3);
    // Isha should be within 3 hours of sunset
    expect((isha - sunsetMs) / 3600000).toBeLessThan(3);
  });
});
