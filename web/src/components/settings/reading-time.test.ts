import { describe, expect, it } from "vitest";

import { formatDay, sameDay } from "./reading-time";

describe("reading time helpers", () => {
  it("decides 'today' in the space's zone, not UTC", () => {
    // 23:30 UTC on the 14th is 01:30 on the 15th in Copenhagen.
    const late = new Date("2026-10-14T23:30:00.000Z");
    const now = new Date("2026-10-15T08:00:00.000Z");
    expect(sameDay(late, now, "Europe/Copenhagen")).toBe(true);
    expect(sameDay(late, now, "UTC")).toBe(false);
    expect(sameDay(late, now, "America/New_York")).toBe(false);
  });

  it("formats another day shortly in the user's language", () => {
    const at = new Date("2026-10-14T12:00:00.000Z");
    expect(formatDay(at, "Europe/Copenhagen", "da")).toMatch(/^14\.? okt\.?$/);
    expect(formatDay(at, "Europe/Copenhagen", "en")).toBe("14 Oct");
  });
});
