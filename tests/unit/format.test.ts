import { test, expect, describe } from "bun:test";
import { formatLocal } from "../../src/format.ts";

describe("formatLocal", () => {
  test("basic HH:MM formatting in UTC", () => {
    const ms = new Date("2026-02-25T06:30:00Z").getTime();
    expect(formatLocal(ms, "UTC")).toBe("06:30");
  });

  test("timezone conversion: UTC to Asia/Dhaka (+6)", () => {
    const ms = new Date("2026-02-25T06:00:00Z").getTime();
    expect(formatLocal(ms, "Asia/Dhaka")).toBe("12:00");
  });

  test("timezone conversion: UTC to America/New_York (EST -5)", () => {
    // Feb is in EST (not DST)
    const ms = new Date("2026-02-25T17:00:00Z").getTime();
    expect(formatLocal(ms, "America/New_York")).toBe("12:00");
  });

  test("midnight wrap — rounds to 00:00", () => {
    const ms = new Date("2026-02-25T23:59:30Z").getTime();
    expect(formatLocal(ms, "UTC")).toBe("00:00");
  });

  test("rounding: 05:02:45 rounds to 05:03", () => {
    const ms = new Date("2026-02-25T05:02:45Z").getTime();
    expect(formatLocal(ms, "UTC")).toBe("05:03");
  });

  test("rounding: 05:02:29 rounds to 05:02", () => {
    const ms = new Date("2026-02-25T05:02:29Z").getTime();
    expect(formatLocal(ms, "UTC")).toBe("05:02");
  });

  test("hour12 flag produces AM/PM format", () => {
    const ms = new Date("2026-02-25T14:30:00Z").getTime();
    const formatted = formatLocal(ms, "UTC", true);
    expect(formatted).toContain("02:30");
    expect(formatted).toContain("PM");
  });

  test("hour12 off produces 24h format", () => {
    const ms = new Date("2026-02-25T14:30:00Z").getTime();
    expect(formatLocal(ms, "UTC", false)).toBe("14:30");
  });
});
