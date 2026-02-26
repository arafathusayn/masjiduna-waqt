import { test, expect, describe } from "bun:test";
import {
  isLeapYear,
  dayOfYear,
  dateByAddingDays,
  dateByAddingMinutes,
  dateByAddingSeconds,
  decomposeHours,
  daysSinceSolstice,
} from "../../src/date-utils.ts";

// ============================================================
// Date utility tests
// ============================================================

describe("isLeapYear", () => {
  const leapYears = [2000, 2004, 2008, 2012, 2016, 2020, 2024, 2400];
  const nonLeapYears = [2001, 2100, 2200, 2300, 2500, 1900, 2003, 2007];

  for (const y of leapYears) {
    test(`${y} is leap`, () => expect(isLeapYear(y)).toBe(true));
  }
  for (const y of nonLeapYears) {
    test(`${y} is not leap`, () => expect(isLeapYear(y)).toBe(false));
  }
});

describe("dayOfYear", () => {
  test("Jan 1", () => {
    expect(dayOfYear(new Date(2015, 0, 1))).toBe(1);
  });
  test("Jan 31", () => {
    expect(dayOfYear(new Date(2015, 0, 31))).toBe(31);
  });
  test("Feb 1", () => {
    expect(dayOfYear(new Date(2015, 1, 1))).toBe(32);
  });
  test("Dec 31 non-leap", () => {
    expect(dayOfYear(new Date(2015, 11, 31))).toBe(365);
  });
  test("Dec 31 leap", () => {
    expect(dayOfYear(new Date(2016, 11, 31))).toBe(366);
  });
  test("Feb 29 leap", () => {
    expect(dayOfYear(new Date(2016, 1, 29))).toBe(60);
  });
  test("Mar 1 leap", () => {
    expect(dayOfYear(new Date(2016, 2, 1))).toBe(61);
  });
  test("Mar 1 non-leap", () => {
    expect(dayOfYear(new Date(2015, 2, 1))).toBe(60);
  });
});

describe("daysSinceSolstice", () => {
  // Northern hemisphere: winter solstice ~Dec 21 (offset +10)
  test("northern — day 1 (Jan 1)", () => {
    const result = daysSinceSolstice(1, 2015, 40);
    expect(result).toBe(11); // 1 + 10
  });
  test("northern — day 355 (Dec 21)", () => {
    const result = daysSinceSolstice(355, 2015, 40);
    expect(result).toBe(0); // 355 + 10 = 365, wraps to 0
  });
  test("northern — day 180 (Jun 29)", () => {
    const result = daysSinceSolstice(180, 2015, 40);
    expect(result).toBe(190); // 180 + 10
  });

  // Southern hemisphere: summer solstice ~Jun 21 (offset -172)
  test("southern — day 1 (Jan 1)", () => {
    const result = daysSinceSolstice(1, 2015, -33);
    expect(result).toBe(194); // 1 - 172 = -171 + 365 = 194
  });
  test("southern — day 200 (Jul 19)", () => {
    const result = daysSinceSolstice(200, 2015, -33);
    expect(result).toBe(28); // 200 - 172
  });

  // Leap year changes southern offset
  test("southern leap — day 1", () => {
    const result = daysSinceSolstice(1, 2016, -33);
    expect(result).toBe(194); // 1 - 173 = -172 + 366 = 194
  });
});

describe("dateByAddingDays", () => {
  test("add days", () => {
    const d = new Date(2015, 0, 1, 12, 0, 0);
    const r = dateByAddingDays(d, 5);
    expect(r.getDate()).toBe(6);
    expect(r.getHours()).toBe(12);
  });

  test("subtract days", () => {
    const d = new Date(2015, 0, 10);
    const r = dateByAddingDays(d, -3);
    expect(r.getDate()).toBe(7);
  });

  test("month boundary", () => {
    const d = new Date(2015, 0, 30);
    const r = dateByAddingDays(d, 3);
    expect(r.getMonth()).toBe(1); // February
    expect(r.getDate()).toBe(2);
  });
});

describe("dateByAddingMinutes", () => {
  test("add 30 minutes", () => {
    const d = new Date(2015, 0, 1, 12, 0, 0);
    const r = dateByAddingMinutes(d, 30);
    expect(r.getMinutes()).toBe(30);
  });
});

describe("dateByAddingSeconds", () => {
  test("add 90 seconds", () => {
    const d = new Date(2015, 0, 1, 12, 0, 0);
    const r = dateByAddingSeconds(d, 90);
    expect(r.getMinutes()).toBe(1);
    expect(r.getSeconds()).toBe(30);
  });
});

describe("decomposeHours", () => {
  test("exact hours", () => {
    const tc = decomposeHours(3);
    expect(tc.hours).toBe(3);
    expect(tc.minutes).toBe(0);
    expect(tc.seconds).toBe(0);
  });

  test("half hour", () => {
    const tc = decomposeHours(12.5);
    expect(tc.hours).toBe(12);
    expect(tc.minutes).toBe(30);
    expect(tc.seconds).toBe(0);
  });

  test("complex value", () => {
    const tc = decomposeHours(15.199);
    expect(tc.hours).toBe(15);
    expect(tc.minutes).toBe(11);
    expect(tc.seconds).toBe(56);
  });
});
