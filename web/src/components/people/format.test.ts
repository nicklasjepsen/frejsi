import { describe, expect, it } from "vitest";

import {
  calendarDaysBetween,
  capitalize,
  daysLeft,
  describeLastSeen,
  deviceSummary,
} from "./format";

const TZ = "Europe/Copenhagen";
// 15 October 2026, 16:52 in Copenhagen (summer time, UTC+2).
const NOW = new Date("2026-10-15T14:52:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);
const hours = (n: number) => minutes(n * 60);

describe("describeLastSeen (Personer-Desktop: Nu · I dag 07:20 · Søndag)", () => {
  it("is never for a person who has not been seen", () => {
    expect(describeLastSeen(null, NOW, TZ, "da")).toEqual({ kind: "never" });
  });

  it("is now within the last five minutes", () => {
    expect(describeLastSeen(minutes(0), NOW, TZ, "da")).toEqual({ kind: "now" });
    expect(describeLastSeen(minutes(4), NOW, TZ, "da")).toEqual({ kind: "now" });
  });

  it("is today with the clock in the space's zone", () => {
    expect(describeLastSeen(hours(2), NOW, TZ, "da")).toEqual({ kind: "today", time: "14:52" });
    // 00:10 Copenhagen is still today there, although it is 22:10 UTC the day before.
    expect(describeLastSeen(new Date("2026-10-14T22:10:00.000Z"), NOW, TZ, "da")).toEqual({
      kind: "today",
      time: "00:10",
    });
  });

  it("is yesterday with the clock", () => {
    expect(describeLastSeen(new Date("2026-10-14T21:00:00.000Z"), NOW, TZ, "da")).toEqual({
      kind: "yesterday",
      time: "23:00",
    });
  });

  it("is the weekday within the last week, lowercase as Intl writes it in Danish", () => {
    // Sunday 11 October 2026.
    expect(describeLastSeen(new Date("2026-10-11T10:00:00.000Z"), NOW, TZ, "da")).toEqual({
      kind: "weekday",
      label: "søndag",
    });
    expect(describeLastSeen(new Date("2026-10-11T10:00:00.000Z"), NOW, TZ, "en")).toEqual({
      kind: "weekday",
      label: "Sunday",
    });
  });

  it("is the date from a week back", () => {
    const seen = describeLastSeen(new Date("2026-10-03T10:00:00.000Z"), NOW, TZ, "da");
    expect(seen.kind).toBe("date");
    expect(seen).toMatchObject({ label: expect.stringContaining("3") as string });
    expect((seen as { label: string }).label).toMatch(/okt/i);
  });
});

describe("calendar days and days left (udløber om 6 dage)", () => {
  it("counts calendar days in the zone, not 24-hour blocks", () => {
    // 23:30 yesterday to 00:30 today: one calendar day, one hour apart.
    expect(
      calendarDaysBetween(
        new Date("2026-10-14T21:30:00.000Z"),
        new Date("2026-10-14T22:30:00.000Z"),
        TZ,
      ),
    ).toBe(1);
    expect(calendarDaysBetween(NOW, NOW, TZ)).toBe(0);
    expect(calendarDaysBetween(hours(72), NOW, TZ)).toBe(3);
  });

  it("daysLeft counts the calendar days to the expiry in the zone, never negative", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(daysLeft(new Date(NOW.getTime() + 7 * day), NOW, TZ)).toBe(7);
    expect(daysLeft(new Date(NOW.getTime() + 6.2 * day), NOW, TZ)).toBe(6);
    // 16:52 today to 04:52 tomorrow is half a day away but expires tomorrow, not today.
    expect(daysLeft(new Date(NOW.getTime() + 0.5 * day), NOW, TZ)).toBe(1);
    expect(daysLeft(new Date(NOW.getTime() + 2 * 60 * 60 * 1000), NOW, TZ)).toBe(0);
    expect(daysLeft(new Date(NOW.getTime() - day), NOW, TZ)).toBe(0);
  });

  it("agrees with the sent line: a link made Monday 20:00 still has a day left on Sunday 21:00", () => {
    // Monday 5 October 2026 20:00 Copenhagen → expires Monday 12 October 20:00.
    const created = new Date("2026-10-05T18:00:00.000Z");
    const expires = new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sunday = new Date("2026-10-11T19:00:00.000Z");
    expect(calendarDaysBetween(created, sunday, TZ)).toBe(6);
    expect(daysLeft(expires, sunday, TZ)).toBe(1);
  });
});

describe("deviceSummary (iPhone · Mac)", () => {
  it("joins the names with a middle dot when every device is named", () => {
    expect(deviceSummary([{ name: "iPhone" }, { name: "Mac" }])).toBe("iPhone · Mac");
  });

  it("is null when a device has no name or there are none, so the count is shown instead", () => {
    expect(deviceSummary([{ name: "iPhone" }, { name: null }])).toBeNull();
    expect(deviceSummary([])).toBeNull();
  });
});

describe("capitalize", () => {
  it("uppercases the first letter only, leaving Danish letters intact", () => {
    expect(capitalize("søndag")).toBe("Søndag");
    expect(capitalize("ørsdag")).toBe("Ørsdag");
    expect(capitalize("")).toBe("");
  });
});
