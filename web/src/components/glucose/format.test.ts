import { describe, expect, it } from "vitest";

import {
  ageOf,
  capitalize,
  dayStart,
  formatBound,
  formatDayTitle,
  formatGlucose,
  isStale,
} from "./format";

const T0 = new Date("2026-10-14T13:13:00.000Z"); // 15:13 in Copenhagen (CEST)
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();

describe("formatGlucose", () => {
  it("writes one decimal with a comma in da and a point in en", () => {
    expect(formatGlucose(6.2, "mmol", "da")).toBe("6,2");
    expect(formatGlucose(6.2, "mmol", "en")).toBe("6.2");
    expect(formatGlucose(10, "mmol", "da")).toBe("10,0");
  });

  it("renders mg/dL spaces as whole numbers (design gap 14)", () => {
    expect(formatGlucose(6.2, "mgdl", "da")).toBe("112");
    expect(formatGlucose(5.6, "mgdl", "en")).toBe("101");
    expect(formatGlucose(5.6, "mgdl", "en")).not.toContain(".");
  });

  it("formats target bounds without a forced decimal", () => {
    expect(formatBound(4, "mmol", "da")).toBe("4");
    expect(formatBound(10, "mmol", "da")).toBe("10");
    expect(formatBound(3.9, "mmol", "da")).toBe("3,9");
    expect(formatBound(4, "mgdl", "en")).toBe("72");
  });
});

describe("ageOf and isStale (plan §9)", () => {
  it("counts whole minutes, then hours and minutes, then more than a day", () => {
    expect(ageOf(minutesAgo(0.5), T0)).toEqual({ kind: "justNow" });
    expect(ageOf(minutesAgo(3), T0)).toEqual({ kind: "minutes", minutes: 3 });
    expect(ageOf(minutesAgo(59.9), T0)).toEqual({ kind: "minutes", minutes: 59 });
    expect(ageOf(minutesAgo(65), T0)).toEqual({ kind: "hours", hours: 1, minutes: 5 });
    expect(ageOf(minutesAgo(25 * 60), T0)).toEqual({ kind: "overADay" });
  });

  it("never goes negative for a reading stamped slightly ahead of the clock", () => {
    expect(ageOf(minutesAgo(-2), T0)).toEqual({ kind: "justNow" });
  });

  it("is stale from 15 minutes on, and with no reading at all", () => {
    const reading = (ts: string) => ({ ts, mmol: 6.2, trend: "flat" as const });
    expect(isStale(reading(minutesAgo(14)), T0)).toBe(false);
    expect(isStale(reading(minutesAgo(15)), T0)).toBe(true);
    expect(isStale(null, T0)).toBe(true);
  });
});

describe("dayStart", () => {
  it("is 06:00 of the same day in the space's zone", () => {
    expect(dayStart(T0, "Europe/Copenhagen", 6).toISOString()).toBe("2026-10-14T04:00:00.000Z");
    expect(dayStart(T0, "UTC", 6).toISOString()).toBe("2026-10-14T06:00:00.000Z");
  });

  it("is 06:00 of the day before when it is earlier than 06:00", () => {
    const early = new Date("2026-10-14T02:30:00.000Z"); // 04:30 in Copenhagen
    expect(dayStart(early, "Europe/Copenhagen", 6).toISOString()).toBe("2026-10-13T04:00:00.000Z");
  });

  it("keeps 06:00 on the wall clock across a daylight-saving change", () => {
    // 04:00 CEST on the morning the clocks went forward: 06:00 the day before was still CET.
    const spring = new Date("2026-03-29T02:00:00.000Z");
    expect(dayStart(spring, "Europe/Copenhagen", 6).toISOString()).toBe("2026-03-28T05:00:00.000Z");
    // 04:00 CET on the morning the clocks went back: 06:00 the day before was CEST.
    const autumn = new Date("2026-10-25T03:00:00.000Z");
    expect(dayStart(autumn, "Europe/Copenhagen", 6).toISOString()).toBe("2026-10-24T04:00:00.000Z");
    // Later the same day, 06:00 is on today's wall clock in the new offset.
    const later = new Date("2026-03-29T10:00:00.000Z");
    expect(dayStart(later, "Europe/Copenhagen", 6).toISOString()).toBe("2026-03-29T04:00:00.000Z");
  });
});

describe("capitalize and formatDayTitle", () => {
  it("capitalises the first letter only", () => {
    expect(capitalize("stiger langsomt", "da")).toBe("Stiger langsomt");
    expect(capitalize("ændrer sig", "da")).toBe("Ændrer sig");
  });

  it("writes the weekday and date in the space's zone", () => {
    expect(formatDayTitle(T0, "Europe/Copenhagen", "da")).toMatch(/^Onsdag .*14\. oktober$/);
    expect(formatDayTitle(T0, "Europe/Copenhagen", "en")).toBe("Wednesday 14 October");
  });
});
