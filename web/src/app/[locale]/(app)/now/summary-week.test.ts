import { expect, it } from "vitest";
import { weeklyWindow } from "@frejsi/shared/insights/week-input";
import { summaryWeek } from "./summary-week";

it.each([
  ["2026-10-14T13:13:00Z", "Europe/Copenhagen", "2026-10-12"],
  ["2026-10-18T16:00:00Z", "Europe/Copenhagen", "2026-10-12"],
  ["2026-10-18T23:00:00Z", "Europe/Copenhagen", "2026-10-12"],
  ["2026-10-19T03:59:59Z", "Europe/Copenhagen", "2026-10-12"],
  ["2026-10-19T04:00:00Z", "Europe/Copenhagen", "2026-10-19"],
  ["2026-10-26T04:59:59Z", "Europe/Copenhagen", "2026-10-19"],
  ["2026-10-26T05:00:00Z", "Europe/Copenhagen", "2026-10-26"],
  ["2026-10-19T05:00:00Z", "America/New_York", "2026-10-12"],
])("selects the summary week at %s in %s", (at, zone, expected) => {
  const now = new Date(at);
  expect(summaryWeek(now, zone)).toBe(expected);
  const generated = weeklyWindow(now, zone);
  if (generated !== null) expect(summaryWeek(now, zone)).toBe(generated);
});
