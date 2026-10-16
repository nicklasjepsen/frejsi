import { expect, it } from "vitest";
import { mealStats } from "../../stats/meal";
import { FakeAiProvider } from "../fake";
import { CappedAiProvider } from "../capped";
import { MemoryAiCallRepository } from "../calls";
import { buildMealInput } from "./input";
import { narrateMeal } from "./meal";
import { narrateWeek } from "./week";
import { WeekInsightInput } from "../../schemas/ai";
const stats = mealStats(
  [],
  { ts: "2026-10-12T10:00:00Z" },
  { low: 4, high: 10 },
  new Date("2026-10-12T14:00:00Z"),
);
const input = buildMealInput({
  locale: "en",
  glucoseUnit: "mmol",
  meal: { title: "Pasta", totalCarbs: 42, slot: "lunch", localTime: "12:00" },
  stats,
  previous: [],
});
const answer = (json: unknown) => ({ kind: "json" as const, json, model: "fixture" });
const capped = (fake: FakeAiProvider) =>
  new CappedAiProvider(fake, new MemoryAiCallRepository(), {
    spaceId: "fictional",
    timezone: "UTC",
  });
it("projects statistics without a timestamp, series, or legacy lead key", () => {
  const projected = buildMealInput({
    ...input,
    previous: [],
    stats: {
      ...stats,
      peak: { ts: "2026-10-12T11:00:00Z", mmol: 11.2, minutesAfterMeal: 60 },
      bolusLeadMinutes: 12,
    },
  });
  expect(projected.stats).toEqual({
    ...input.stats,
    peak: { mmol: 11.2, minutesAfterMeal: 60 },
    leadMinutes: 12,
  });
  expect(JSON.stringify(projected)).not.toMatch(/\bts\b|readings|bolus|2026-10-12T/);
});
it("rejects invented numbers, retries once, and sends only the projected input", async () => {
  const fake = new FakeAiProvider([
    answer({ text: "The meal contained 99 grams of carbs." }),
    answer({ text: "The meal contained 42 grams of carbs." }),
  ]);
  expect((await narrateMeal(capped(fake), input)).text).toContain("42");
  expect(fake.calls).toHaveLength(2);
  expect(fake.calls[0]).toMatchObject({
    request: {
      role: "everyday",
      effort: "medium",
      messages: [{ content: [{ text: JSON.stringify(input) }] }],
    },
  });
});
it("rejects unsafe meal text after exactly two attempts", async () => {
  const fake = new FakeAiProvider([
    answer({ text: "Take insulin after this meal." }),
    answer({ text: "Take insulin after this meal." }),
  ]);
  await expect(narrateMeal(capped(fake), input)).rejects.toMatchObject({ code: "ai-rejected" });
  expect(fake.calls).toHaveLength(2);
});
it("drops unsafe weekly questions while retaining the summary and safe questions", async () => {
  const week = WeekInsightInput.parse({
    locale: "en",
    glucoseUnit: "mmol",
    isoWeek: 42,
    weekStart: "2026-10-12",
    numbers: {
      lowEpisodes: { count: 0, atNight: 0 },
      carbsPerDay: 0,
      mealCount: 0,
      lead: { registered: 0, of: 0 },
    },
    days: Array.from({ length: 7 }, (_, i) => ({
      localDate: `2026-10-${12 + i}`,
      mealCount: 0,
      totalCarbs: 0,
    })),
    meals: [],
  });
  const fake = new FakeAiProvider([
    answer({
      summary: "The week contains no recorded meals.",
      questions: ["What patterns appeared this week?", "Should I take insulin at lunch?"],
    }),
  ]);
  expect(await narrateWeek(capped(fake), week)).toMatchObject({
    rejectedCount: 1,
    questions: ["What patterns appeared this week?"],
  });
});
it("accepts the same decimal in either locale's notation", async () => {
  const withPeak = {
    ...input,
    stats: { ...input.stats, peak: { mmol: 11.2, minutesAfterMeal: 65 } },
  };
  const fake = new FakeAiProvider([answer({ text: "The peak was 11,2 after 65 minutes." })]);
  expect((await narrateMeal(capped(fake), withPeak)).text).toContain("11,2");
});
it("retries an unsafe weekly summary once, then rejects without returning text", async () => {
  const week = WeekInsightInput.parse({
    locale: "en",
    glucoseUnit: "mmol",
    isoWeek: 42,
    weekStart: "2026-10-12",
    numbers: {
      lowEpisodes: { count: 0, atNight: 0 },
      carbsPerDay: 0,
      mealCount: 0,
      lead: { registered: 0, of: 0 },
    },
    days: Array.from({ length: 7 }, (_, i) => ({
      localDate: `2026-10-${12 + i}`,
      mealCount: 0,
      totalCarbs: 0,
    })),
    meals: [],
  });
  const unsafe = answer({
    summary: "Take insulin after this meal.",
    questions: ["What patterns appeared this week?"],
  });
  const fake = new FakeAiProvider([unsafe, unsafe]);
  await expect(narrateWeek(capped(fake), week)).rejects.toMatchObject({ code: "ai-rejected" });
  expect(fake.calls).toHaveLength(2);
});
it("includes and accepts deterministic display glucose statistics for mg/dL", async () => {
  const inputMgdl = {
    ...input,
    glucoseUnit: "mgdl" as const,
    stats: { ...input.stats, peak: { mmol: 11.2, minutesAfterMeal: 65 } },
  };
  const fake = new FakeAiProvider([answer({ text: "The peak was 202 after 65 minutes." })]);
  expect((await narrateMeal(capped(fake), inputMgdl)).text).toContain("202");
  const call = fake.calls[0];
  const content = call?.kind === "complete" ? call.request.messages[0]?.content[0] : undefined;
  if (content?.type !== "text") throw new Error("Expected statistics input");
  expect(content.text).toContain('"displayPeakValues":[202]');
});
