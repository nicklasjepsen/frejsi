import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { Reading } from "../schemas/glucose";
import type { MealCurveView } from "../schemas/history";
import { mealStats } from "../stats/meal";
import { buildMealInput } from "../ai/insight/input";
const fixture = z
  .object({
    mealTs: z.string(),
    target: z.object({ low: z.number(), high: z.number() }),
    readings: z.array(Reading),
  })
  .parse(
    JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, "../../../fixtures/curves/meal-typical.json"),
        "utf8",
      ),
    ),
  );
it("projects the typical curve's computed stats with no timestamp or series", () => {
  const input = buildMealInput({
    locale: "en",
    glucoseUnit: "mmol",
    meal: { title: "Fictional lunch", totalCarbs: 50, slot: "lunch", localTime: "12:00" },
    stats: mealStats(
      fixture.readings,
      { ts: fixture.mealTs },
      fixture.target,
      new Date("2026-10-15T00:00:00Z"),
    ),
    previous: [],
  });
  const serialized = JSON.stringify(input);
  expect(serialized).not.toMatch(/"ts"|"readings"|trend|bolus|2026-10-14T/);
  expect(input.stats.peak).toEqual({ mmol: 9.6, minutesAfterMeal: 65 });
  expect(Object.keys(input.stats).sort()).toEqual(["inRange", "peak", "readingCount"]);
  // Peak is an aggregate allowed at the boundary. Individual samples cannot survive the projection.
  expect(serialized).not.toContain(JSON.stringify(fixture.readings[0]));
});
// This function is never executed; tsc checks the forbidden input shapes.
export function typeBoundary(raw: Reading[], curve: MealCurveView) {
  const fields = {
    locale: "en" as const,
    glucoseUnit: "mmol" as const,
    meal: { title: "Pasta", totalCarbs: 42, slot: "lunch" as const, localTime: "12:00" },
    previous: [],
  };
  // @ts-expect-error A series is not statistics.
  buildMealInput({ ...fields, stats: raw });
  // @ts-expect-error A curve view is not statistics.
  buildMealInput({ ...fields, stats: curve });
}
