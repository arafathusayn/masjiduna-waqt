/**
 * Format a UTC Date to a local "HH:MM" string using the IANA timezone.
 * This is the ONLY place where the timezone ID is consumed.
 * All computation stays in UTC; display converts at the boundary.
 *
 * The input Date is rounded to the nearest minute before formatting,
 * since toLocaleTimeString truncates seconds (e.g. 05:02:45 → "05:02").
 * Without rounding, this produces a systematic -1 min bias vs APIs
 * that round to nearest minute.
 */

const _fmtCache = new Map<string, Intl.DateTimeFormat>();

function _getFmt(tzId: string, hour12: boolean): Intl.DateTimeFormat {
  const key = hour12 ? tzId + "\x01" : tzId;
  let fmt = _fmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tzId,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: hour12 ? "h12" : "h23",
    });
    _fmtCache.set(key, fmt);
  }
  return fmt;
}

export function formatLocal(
  ms: number,
  timezoneId: string,
  hour12 = false,
): string {
  const roundedMs = Math.round(ms / 60_000) * 60_000;
  return _getFmt(timezoneId, hour12).format(new Date(roundedMs));
}
