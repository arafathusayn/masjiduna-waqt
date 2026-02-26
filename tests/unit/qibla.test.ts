import { test, expect, describe } from "bun:test";
import { computeQibla } from "../../src/qibla.ts";

// ============================================================
// Qibla bearing — 11 cities
// ============================================================

describe("Qibla direction", () => {
  const cities: [string, number, number, number][] = [
    ["Washington DC", 38.9072, -77.0369, 56.56],
    ["New York City", 40.7128, -74.0059, 58.4817],
    ["San Francisco", 37.7749, -122.4194, 18.843],
    ["Anchorage", 61.2181, -149.9003, 350.883],
    ["Sydney", -33.8688, 151.2093, 277.4996],
    ["Auckland", -36.8485, 174.7633, 261.197],
    ["London", 51.5074, -0.1278, 118.987],
    ["Paris", 48.8566, 2.3522, 119.163],
    ["Oslo", 59.9139, 10.7522, 139.027],
    ["Islamabad", 33.7294, 73.0931, 255.882],
    ["Tokyo", 35.6895, 139.6917, 293.021],
  ];

  for (const [name, lat, lng, expected] of cities) {
    test(name, () => {
      const qibla = computeQibla(lat, lng);
      expect(qibla).toBeCloseTo(expected, 1);
    });
  }
});
