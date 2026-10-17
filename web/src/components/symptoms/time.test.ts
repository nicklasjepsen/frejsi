import { describe, expect, it } from "vitest";
import { dayOf, instantOn, isAhead, localClock, longDay, recentDays } from "./time";

const zone = "Europe/Copenhagen";
const iso = (at: Date | null) => at?.toISOString();
describe("the sheet's day and time fields", () => {
  it("offers today and the six days before it by the space's calendar", () => {
    const now = new Date("2026-10-15T22:10:00.000Z"); // 00:10 CEST on the 16th
    expect(recentDays(now, zone)).toEqual([
      "2026-10-16",
      "2026-10-15",
      "2026-10-14",
      "2026-10-13",
      "2026-10-12",
      "2026-10-11",
      "2026-10-10",
    ]);
  });
  it("places HH:MM on the chosen local date in the space's zone", () => {
    const now = new Date("2026-10-15T13:00:00.000Z"); // 15:00 CEST
    expect(iso(instantOn("2026-10-15", "14:30", zone, now))).toBe("2026-10-15T12:30:00.000Z");
    expect(iso(instantOn("2026-10-12", "08:05", zone, now))).toBe("2026-10-12T06:05:00.000Z");
    expect(localClock(now, zone)).toBe("15:00");
  });
  it("says when a time on today's date is more than ten minutes ahead", () => {
    const now = new Date("2026-10-15T13:00:00.000Z"); // 15:00 CEST
    const soon = instantOn("2026-10-15", "15:10", zone, now);
    const later = instantOn("2026-10-15", "15:11", zone, now);
    expect(soon && isAhead(soon, now)).toBe(false);
    expect(later && isAhead(later, now)).toBe(true);
  });
  it("resolves each day on its own offset across the clock change", () => {
    // 03:10 CET on 25 October, after summer time ended; 23:50 the day before was CEST.
    const after = new Date("2026-10-25T02:10:00.000Z");
    expect(iso(instantOn("2026-10-24", "23:50", zone, after))).toBe("2026-10-24T21:50:00.000Z");
    expect(iso(instantOn("2026-10-25", "01:30", zone, after))).toBe("2026-10-24T23:30:00.000Z");
    // 03:10 CEST on 29 March, after the spring change; 23:50 the day before was CET.
    const spring = new Date("2026-03-29T01:10:00.000Z");
    expect(iso(instantOn("2026-03-28", "23:50", zone, spring))).toBe("2026-03-28T22:50:00.000Z");
  });
  it("picks the occurrence that has passed in the hour that repeats when summer time ends", () => {
    // 02:15 CEST on 25 October, the first pass through the repeated hour: 02:10 was five minutes ago.
    const first = new Date("2026-10-25T00:15:00.000Z");
    expect(iso(instantOn("2026-10-25", "02:10", zone, first))).toBe("2026-10-25T00:10:00.000Z");
    // 02:15 CET, the second pass: 02:10 is again five minutes ago.
    const second = new Date("2026-10-25T01:15:00.000Z");
    expect(iso(instantOn("2026-10-25", "02:10", zone, second))).toBe("2026-10-25T01:10:00.000Z");
    // 02:30 on 29 March does not exist; it lands on the clock after the jump.
    const gap = new Date("2026-03-29T10:00:00.000Z");
    expect(iso(instantOn("2026-03-29", "02:30", zone, gap))).toBe("2026-03-29T01:30:00.000Z");
  });
  it("refuses nonsense", () => {
    const now = new Date("2026-10-15T13:00:00.000Z");
    expect(instantOn("2026-10-15", "25:00", zone, now)).toBeNull();
    expect(instantOn("2026-10-15", "9:00", zone, now)).toBeNull();
    expect(instantOn("15-10-2026", "09:00", zone, now)).toBeNull();
  });
  it("names the day of an instant relative to now, and a date in full", () => {
    const now = new Date("2026-10-15T22:10:00.000Z"); // 00:10 CEST on the 16th
    expect(dayOf(new Date("2026-10-15T22:05:00.000Z"), now, zone)).toBe("today");
    expect(dayOf(new Date("2026-10-15T21:50:00.000Z"), now, zone)).toBe("yesterday");
    expect(dayOf(new Date("2026-10-13T10:00:00.000Z"), now, zone)).toBe("earlier");
    expect(longDay("2026-10-13", "da")).toMatch(/^tirsdag (den )?13\. oktober$/);
    expect(longDay("2026-10-13", "en")).toMatch(/^Tuesday,? (13 October|October 13)$/);
  });
});
