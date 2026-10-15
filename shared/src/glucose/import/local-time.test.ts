import { describe, expect, it } from "vitest";

import { isTimezone, localToUtc } from "./local-time";

describe("localToUtc", () => {
  it("reads a wall-clock time in the space's timezone, with a T or a space, with or without seconds", () => {
    expect(localToUtc("2026-10-15T07:30:00", "Europe/Copenhagen")?.toISOString()).toBe(
      "2026-10-15T05:30:00.000Z",
    );
    expect(localToUtc("2026-01-15 7:30", "Europe/Copenhagen")?.toISOString()).toBe(
      "2026-01-15T06:30:00.000Z",
    );
    expect(localToUtc("2026-10-15T07:30:00", "America/New_York")?.toISOString()).toBe(
      "2026-10-15T11:30:00.000Z",
    );
    expect(localToUtc("2026-10-15T07:30:00", "UTC")?.toISOString()).toBe(
      "2026-10-15T07:30:00.000Z",
    );
  });

  it("handles the DST change: the repeated hour takes its first instant, the skipped hour follows on", () => {
    // 2026-10-25 03:00 CEST becomes 02:00 CET; 02:30 happens twice.
    expect(localToUtc("2026-10-25T02:30:00", "Europe/Copenhagen")?.toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    expect(localToUtc("2026-10-25T03:30:00", "Europe/Copenhagen")?.toISOString()).toBe(
      "2026-10-25T02:30:00.000Z",
    );
    // 2026-03-29 02:00 CET becomes 03:00 CEST; 02:30 never happens.
    expect(localToUtc("2026-03-29T02:30:00", "Europe/Copenhagen")?.toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(localToUtc("2026-03-29T03:30:00", "Europe/Copenhagen")?.toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });

  it("is null for anything that is not a timestamp", () => {
    for (const text of ["", "FirstName", "2026-10-15", "15/10/2026 07:30", "2026-13-40T07:30:00"]) {
      expect(localToUtc(text, "Europe/Copenhagen"), text).toBeNull();
    }
  });

  it("knows a timezone from a made-up one", () => {
    expect(isTimezone("Europe/Copenhagen")).toBe(true);
    expect(isTimezone("Mars/Olympus")).toBe(false);
  });
});
