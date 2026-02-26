import { test, expect, describe } from "bun:test";
import {
  sinDeg,
  cosDeg,
  tanDeg,
  asinDeg,
  acosDeg,
  atanDeg,
  atan2Deg,
  normalizeDeg,
} from "../../src/units.ts";

describe("trig helpers (degrees)", () => {
  test("sinDeg at known angles", () => {
    expect(sinDeg(0)).toBeCloseTo(0, 10);
    expect(sinDeg(30)).toBeCloseTo(0.5, 10);
    expect(sinDeg(90)).toBeCloseTo(1, 10);
    expect(sinDeg(180)).toBeCloseTo(0, 10);
    expect(sinDeg(-30)).toBeCloseTo(-0.5, 10);
  });

  test("cosDeg at known angles", () => {
    expect(cosDeg(0)).toBeCloseTo(1, 10);
    expect(cosDeg(60)).toBeCloseTo(0.5, 10);
    expect(cosDeg(90)).toBeCloseTo(0, 10);
    expect(cosDeg(180)).toBeCloseTo(-1, 10);
  });

  test("tanDeg at known angles", () => {
    expect(tanDeg(0)).toBeCloseTo(0, 10);
    expect(tanDeg(45)).toBeCloseTo(1, 10);
    expect(tanDeg(-45)).toBeCloseTo(-1, 10);
  });

  test("asinDeg inverse of sinDeg", () => {
    expect(asinDeg(0.5)).toBeCloseTo(30, 10);
    expect(asinDeg(1)).toBeCloseTo(90, 10);
    expect(asinDeg(-1)).toBeCloseTo(-90, 10);
  });

  test("acosDeg inverse of cosDeg", () => {
    expect(acosDeg(0.5)).toBeCloseTo(60, 10);
    expect(acosDeg(1)).toBeCloseTo(0, 10);
    expect(acosDeg(-1)).toBeCloseTo(180, 10);
  });

  test("atanDeg inverse of tanDeg", () => {
    expect(atanDeg(1)).toBeCloseTo(45, 10);
    expect(atanDeg(0)).toBeCloseTo(0, 10);
    expect(atanDeg(-1)).toBeCloseTo(-45, 10);
  });

  test("atan2Deg quadrant handling", () => {
    expect(atan2Deg(1, 1)).toBeCloseTo(45, 10);
    expect(atan2Deg(1, -1)).toBeCloseTo(135, 10);
    expect(atan2Deg(-1, -1)).toBeCloseTo(-135, 10);
    expect(atan2Deg(-1, 1)).toBeCloseTo(-45, 10);
  });
});

describe("normalizeDeg", () => {
  test("already in [0, 360)", () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(359.9)).toBeCloseTo(359.9, 10);
  });

  test("negative angles", () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(-360)).toBe(0);
    expect(normalizeDeg(-1)).toBe(359);
  });

  test("angles >= 360", () => {
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(720)).toBe(0);
  });
});
