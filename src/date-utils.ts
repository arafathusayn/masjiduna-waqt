import type { Rounding } from "./schema.ts";

// ============================================================
// Date utilities — pure functions, no branded types internally.
// ============================================================

/** Whether a Gregorian year is a leap year. */
export function isLeapYear(year: number): boolean {
  if (year % 4 !== 0) return false;
  if (year % 100 === 0 && year % 400 !== 0) return false;
  return true;
}

/** Cumulative days before each month (non-leap). Index 0 = Jan. */
const MONTH_CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Day of year (1–366) for a Date. Uses local date components. */
export function dayOfYear(date: Date): number {
  const m = date.getMonth();
  return (
    MONTH_CUM[m]! + date.getDate() + +(m > 1 && isLeapYear(date.getFullYear()))
  );
}

/** Create a new Date by adding whole days. */
export function dateByAddingDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Create a new Date by adding minutes. */
export function dateByAddingMinutes(date: Date, minutes: number): Date {
  return dateByAddingSeconds(date, minutes * 60);
}

/** Create a new Date by adding seconds. */
export function dateByAddingSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/**
 * Round a Date to the nearest minute using the specified rounding mode.
 *
 * - "nearest": >= 30 seconds rounds up, else rounds down
 * - "up": always rounds up to the next minute
 * - "none": no rounding
 */
export function roundedMinute(
  date: Date,
  rounding: Rounding = "nearest" as Rounding,
): Date {
  const seconds = date.getUTCSeconds();
  let offset: number;
  if (rounding === "up") {
    offset = 60 - seconds;
  } else if (rounding === "none") {
    offset = 0;
  } else {
    // nearest
    offset = seconds >= 30 ? 60 - seconds : -1 * seconds;
  }
  return dateByAddingSeconds(date, offset);
}

/**
 * Decompose decimal hours into hours, minutes, seconds.
 * Decomposes decimal hours into integer hours, minutes, seconds.
 */
export function decomposeHours(num: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const hours = Math.floor(num);
  const minutes = Math.floor((num - hours) * 60);
  const seconds = Math.floor((num - (hours + minutes / 60)) * 60 * 60);
  return { hours, minutes, seconds };
}

/**
 * Number of days since the winter solstice.
 * Used by MoonsightingCommittee seasonal twilight calculations.
 *
 * Northern hemisphere: offset by +10 days (solstice ~Dec 21)
 * Southern hemisphere: offset by −172 or −173 days (solstice ~Jun 21)
 */
export function daysSinceSolstice(
  doy: number,
  year: number,
  latitude: number,
): number {
  const daysInYear = isLeapYear(year) ? 366 : 365;

  if (latitude >= 0) {
    let d = doy + 10;
    if (d >= daysInYear) d -= daysInYear;
    return d;
  } else {
    const southernOffset = isLeapYear(year) ? 173 : 172;
    let d = doy - southernOffset;
    if (d < 0) d += daysInYear;
    return d;
  }
}
