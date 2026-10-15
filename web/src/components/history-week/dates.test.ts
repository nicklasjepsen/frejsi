import { expect, it } from "vitest";
import { mondayOf, selectedWeek, weekDateLabel } from "./dates";
it("normalizes calendar dates to Monday across year boundaries", () => {
  expect(mondayOf("2026-01-01")).toBe("2025-12-29");
  expect(mondayOf("2026-10-18")).toBe("2026-10-12");
});
it("uses the space's current week for missing, invalid or future starts", () => {
  const now = new Date("2026-10-18T23:00:00Z");
  for (const date of [undefined, "wrong", "2026-02-30", "2026-11-01"]) {
    expect(selectedWeek(date, "Europe/Copenhagen", now)).toBe("2026-10-19");
  }
});
it("formats real ISO weeks and date intervals through Intl, including year changes", () => {
  expect(weekDateLabel("2025-10-06", "da")).toMatch(/6\.–12\. oktober/);
  expect(weekDateLabel("2026-12-28", "en")).toMatch(/28 December 2026.*3 January 2027/);
});
