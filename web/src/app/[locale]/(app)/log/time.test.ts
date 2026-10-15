import { describe, expect, it } from "vitest";

import { formatClock, isSameLocalDay, withLocalTime } from "./time";

const zone = "Europe/Copenhagen";

describe("log time helpers", () => {
  it("moves a time to a local HH:MM on the same local day", () => {
    const base = new Date("2026-10-14T10:10:30.000Z"); // 12:10 in Copenhagen
    const moved = withLocalTime(base, "11:45", zone);
    expect(moved?.toISOString()).toBe("2026-10-14T09:45:00.000Z");
    expect(formatClock(moved ?? base, zone)).toBe("11:45");
    expect(withLocalTime(base, "25:00", zone)).toBeNull();
    expect(withLocalTime(base, "noon", zone)).toBeNull();
  });

  it("keeps the local clock right on a DST day", () => {
    const base = new Date("2026-10-25T12:00:00.000Z"); // 13:00 CET, the day summer time ends
    const early = withLocalTime(base, "01:30", zone);
    expect(formatClock(early ?? base, zone)).toBe("01:30");
  });

  it("compares local days, not UTC days", () => {
    expect(
      isSameLocalDay(new Date("2026-10-14T22:30:00Z"), new Date("2026-10-15T08:00:00Z"), zone),
    ).toBe(true);
    expect(
      isSameLocalDay(new Date("2026-10-14T21:30:00Z"), new Date("2026-10-14T22:30:00Z"), zone),
    ).toBe(false);
  });
});
