import { describe, expect, it } from "vitest";
import { mealStats } from "../../stats/meal";
import { FakeAiProvider } from "../fake";
import { CappedAiProvider } from "../capped";
import { MemoryAiCallRepository } from "../calls";
import { buildMealInput, buildWeekInput } from "./input";
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
it("rejects invented weekly summary numerals and drops invented question numerals", async () => {
  const week = WeekInsightInput.parse({
    locale: "en",
    glucoseUnit: "mmol",
    isoWeek: 42,
    weekStart: "2026-10-12",
    numbers: {
      inRangePercent: 60,
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
  const invented = answer({ summary: "Time in range was 80% this week.", questions: [] });
  const rejected = new FakeAiProvider([invented, invented]);
  await expect(narrateWeek(capped(rejected), week)).rejects.toMatchObject({ code: "ai-rejected" });
  expect(rejected.calls).toHaveLength(2);
  const fake = new FakeAiProvider([
    answer({
      summary: "Time in range was 60% this week.",
      questions: ["What patterns appeared this week?", "Why was time in range 80% this week?"],
    }),
  ]);
  expect(await narrateWeek(capped(fake), week)).toMatchObject({
    summary: "Time in range was 60% this week.",
    questions: ["What patterns appeared this week?"],
    rejectedCount: 1,
  });
});

describe("symptoms next to the meal, never explained (v0.6.0 plan §5)", () => {
  const mealTs = "2026-10-12T10:00:00Z";
  const logged = [
    { kind: "stomach-ache", ts: "2026-10-12T11:30:00Z" }, // +90 min
    { kind: "dizzy", ts: "2026-10-12T09:00:00Z" }, // -60 min, the edge
    { kind: "tired", ts: "2026-10-12T14:00:00Z" }, // +240 min, the edge
    { kind: "nausea", ts: "2026-10-12T08:59:00Z" }, // just before the window
    { kind: "headache", ts: "2026-10-12T14:01:00Z" }, // just after it
  ];
  it("carries the kind and the minutes after the meal for the symptoms within −1 h/+4 h", () => {
    const projected = buildMealInput({ ...input, stats, previous: [], mealTs, loggedSymptoms: logged });
    expect(projected.symptoms).toEqual([
      { kind: "dizzy", minutesAfterMeal: -60 },
      { kind: "stomach-ache", minutesAfterMeal: 90 },
      { kind: "tired", minutesAfterMeal: 240 },
    ]);
    const text = JSON.stringify(projected.symptoms);
    expect(text).not.toMatch(/mmol|readings|glucose|note|ts"/);
    expect(Object.keys(projected.symptoms?.[0] ?? {}).sort()).toEqual([
      "kind",
      "minutesAfterMeal",
    ]);
    expect(buildMealInput({ ...input, stats, previous: [] })).not.toHaveProperty("symptoms");
    expect(JSON.stringify(projected)).not.toMatch(/\bts\b|readings|bolus|2026-10-12T/);
  });
  it("counts the week's symptoms per kind, most frequent first, and nothing else", () => {
    const week = buildWeekInput({
      locale: "en",
      glucoseUnit: "mmol",
      isoWeek: 42,
      weekStart: "2026-10-12",
      timezone: "UTC",
      numbers: {
        inRangePercent: 60,
        belowPercent: 2,
        lowEpisodes: { count: 0, atNight: 0 },
        carbsPerDay: 0,
        mealCount: 0,
        bolusLead: { registered: 0, of: 0 },
      },
      days: Array.from({ length: 7 }, (_, i) => ({
        localDate: `2026-10-${12 + i}`,
        mealCount: 0,
        totalCarbs: 0,
      })),
      meals: [],
      symptoms: [{ kind: "tired" }, { kind: "dizzy" }, { kind: "tired" }],
    });
    expect(week.symptomCounts).toEqual([
      { kind: "tired", count: 2 },
      { kind: "dizzy", count: 1 },
    ]);
    expect(JSON.stringify(week.symptomCounts)).not.toMatch(/mmol|readings|glucose/);
  });
  it("tells both prompts to mention a symptom as logged and never to explain it", async () => {
    const { mealPrompt } = await import("./prompt-meal");
    const { weekPrompt } = await import("./prompt-week");
    for (const prompt of [mealPrompt, weekPrompt]) {
      expect(prompt).toMatch(/symptom/i);
      expect(prompt).toMatch(/as logged/i);
      expect(prompt).toMatch(/never explain/i);
    }
  });
  it("rejects a narration that explains a symptom medically, after two attempts, in both languages", async () => {
    const withSymptom = buildMealInput({
      ...input,
      stats,
      previous: [],
      mealTs,
      loggedSymptoms: [{ kind: "dizzy", ts: "2026-10-12T11:00:00Z" }],
    });
    for (const text of [
      "The dizziness came because your blood sugar fell after 42 grams.",
      "Svimmelheden skyldes at dit blodsukker faldt efter 42 gram.",
      "Feeling dizzy is a symptom of a low after the 42 grams.",
    ]) {
      const fake = new FakeAiProvider([answer({ text }), answer({ text })]);
      await expect(narrateMeal(capped(fake), withSymptom)).rejects.toMatchObject({
        code: "ai-rejected",
      });
      expect(fake.calls).toHaveLength(2);
    }
    const fake = new FakeAiProvider([
      answer({ text: "Dizzy was logged 60 minutes after the meal of 42 grams." }),
    ]);
    expect((await narrateMeal(capped(fake), withSymptom)).text).toContain("logged");
  });
  it("drops a weekly question that explains a symptom and rejects such a summary", async () => {
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
      symptomCounts: [{ kind: "tired", count: 2 }],
    });
    const fake = new FakeAiProvider([
      answer({
        summary: "Tired was logged 2 times this week.",
        questions: ["Was the tiredness caused by the blood sugar?", "What patterns appeared?"],
      }),
    ]);
    expect(await narrateWeek(capped(fake), week)).toMatchObject({
      questions: ["What patterns appeared?"],
      rejectedCount: 1,
    });
    const unsafe = answer({
      summary: "Tired was logged 2 times, a sign of high blood sugar.",
      questions: [],
    });
    const rejected = new FakeAiProvider([unsafe, unsafe]);
    await expect(narrateWeek(capped(rejected), week)).rejects.toMatchObject({
      code: "ai-rejected",
    });
  });
});
