import { expect, it } from "vitest";
import { buildWeekInsightInput, weeklyWindow, readyAt } from "./week-input";
import { MemoryWeekSource } from "./memory";
it("uses each space's local Sunday evening and the same week on Monday morning", () => {
  expect(weeklyWindow(new Date("2026-10-18T17:00:00Z"), "Europe/Copenhagen")).toBe("2026-10-12");
  expect(weeklyWindow(new Date("2026-10-18T17:00:00Z"), "America/New_York")).toBeNull();
  expect(weeklyWindow(new Date("2026-10-18T22:00:00Z"), "America/New_York")).toBe("2026-10-12");
  expect(weeklyWindow(new Date("2026-10-19T03:00:00Z"), "Europe/Copenhagen")).toBe("2026-10-12");
  expect(weeklyWindow(new Date("2026-10-19T04:00:00Z"), "Europe/Copenhagen")).toBeNull();
  expect(readyAt("2026-10-19", "Europe/Copenhagen").toISOString()).toBe("2026-10-25T17:00:00.000Z");
});
it("computes week statistics from a memory source and projects away all series and ids", async () => {
  const source = new MemoryWeekSource();
  const space = {
    id: "fictional",
    timezone: "Europe/Copenhagen",
    locale: "en" as const,
    glucoseUnit: "mmol" as const,
    target: { low: 4, high: 10 },
    aiProvider: "anthropic" as const,
  };
  source.meals.push({
    id: "meal-fictional",
    ts: "2026-10-12T10:00:00Z",
    totalCarbs: 42,
    title: "Pasta",
  });
  source.readings.push({ ts: "2026-10-12T10:00:00Z", mmol: 6.3, trend: "flat" });
  const input = await buildWeekInsightInput(
    space,
    "2026-10-12",
    source,
    new Date("2026-10-18T17:00:00Z"),
  );
  expect(input.numbers.mealCount).toBe(1);
  expect(input.days).toHaveLength(7);
  expect(JSON.stringify(input)).not.toMatch(/meal-fictional|\bts\b|readings|bolus|T10:00/);
});
