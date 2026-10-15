import { describe, expect, it } from "vitest";

import { dayRange } from "./day-range";
import { mealSlot, mealTitle } from "./title";

describe("space-local meal helpers", () => {
  const isoRange = (date: string, zone: string) => dayRange(date, zone).map((d) => d.toISOString());
  it("returns the space's half-open UTC day rather than a fixed timezone", () => {
    expect(isoRange("2026-10-14", "Europe/Copenhagen")).toEqual([
      "2026-10-13T22:00:00.000Z",
      "2026-10-14T22:00:00.000Z",
    ]);
    expect(isoRange("2026-10-14", "America/New_York")).toEqual([
      "2026-10-14T04:00:00.000Z",
      "2026-10-15T04:00:00.000Z",
    ]);
    expect(isoRange("2026-03-29", "Europe/Copenhagen")).toEqual([
      "2026-03-28T23:00:00.000Z",
      "2026-03-29T22:00:00.000Z",
    ]);
    expect(isoRange("2026-10-25", "Europe/Copenhagen")).toEqual([
      "2026-10-24T22:00:00.000Z",
      "2026-10-25T23:00:00.000Z",
    ]);
    expect(isoRange("2026-12-31", "Asia/Kathmandu")).toEqual([
      "2026-12-30T18:15:00.000Z",
      "2026-12-31T18:15:00.000Z",
    ]);
    expect(() => dayRange("2026-02-30", "UTC")).toThrow();
    expect(() => dayRange("2026-10-14", "invalid")).toThrow();
  });
  it("handles zones whose day begins after a skipped midnight", () => {
    expect(isoRange("2026-09-06", "America/Santiago")).toEqual([
      "2026-09-06T04:00:00.000Z",
      "2026-09-07T03:00:00.000Z",
    ]);
  });
  it("uses the note or joins the snapshot names in the user's locale", () => {
    const items = [{ name: "Rugbrød med ost" }, { name: "Æble" }];
    expect(mealTitle(items, undefined, "da")).toBe("Rugbrød med ost og Æble");
    expect(mealTitle(items, undefined, "en")).toBe("Rugbrød med ost and Æble");
    expect(mealTitle(items, "Example packed lunch", "en")).toBe("Example packed lunch");
  });
  it.each([
    ["07:15", "breakfast"],
    ["12:10", "lunch"],
    ["18:30", "dinner"],
    ["15:00", "snack"],
  ])("maps local %s to %s", (time, slot) => {
    const ts = new Date(`2026-10-14T${time}:00+02:00`);
    expect(mealSlot(ts, "Europe/Copenhagen")).toBe(slot);
  });
  it("uses the supplied timezone to choose the slot", () => {
    expect(mealSlot("2026-10-14T10:10:00Z", "America/New_York")).toBe("breakfast");
    expect(mealSlot("2026-10-14T10:10:00Z", "Europe/Copenhagen")).toBe("lunch");
  });
});
