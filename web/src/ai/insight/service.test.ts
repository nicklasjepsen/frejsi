// @vitest-environment node
import { expect, it, vi } from "vitest";
import { HttpError, SessionContext, type EmitFn } from "@frejsi/shared";
import { FakeAiProvider } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai/capped";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { MemoryInsightRepository } from "@frejsi/shared/insights/memory";
import { buildMealInput } from "@frejsi/shared/ai/insight/input";
import { mealInsight, symptomWindowOrNone } from "./service";
const session = SessionContext.parse({
  userId: "fictional",
  name: "Fictional member",
  simpleMode: false,
  accent: "olive",
  theme: "system",
  locale: "en",
  memberships: [{ spaceId: "space", role: "owner" }],
});
const input = buildMealInput({
  locale: "en",
  glucoseUnit: "mmol",
  meal: { title: "Pasta", totalCarbs: 42, slot: "lunch", localTime: "12:00" },
  stats: {
    inRange: {
      minutes: 120,
      coveredMinutes: 180,
      windowMinutes: 180,
      complete: true,
      belowMinutes: 0,
      aboveMinutes: 60,
    },
    readingCount: 37,
  },
  previous: [],
});
function setup() {
  const fake = new FakeAiProvider(() => ({
    kind: "json",
    json: { text: "The meal contained 42 grams of carbs." },
    model: "fixture",
  }));
  const provider = new CappedAiProvider(fake, new MemoryAiCallRepository(), {
    spaceId: "space",
    timezone: "UTC",
  });
  return {
    fake,
    deps: {
      repo: new MemoryInsightRepository(),
      emit: vi.fn<EmitFn>(),
      provider: () => provider,
      symptomsAround: () => Promise.resolve(null),
    },
  };
}
it("caches per projected stats hash, shares concurrent reads, and regenerates after edits", async () => {
  const { fake, deps } = setup();
  const first = await Promise.all([
    mealInsight("space", "meal", session, input, deps),
    mealInsight("space", "meal", session, input, deps),
  ]);
  expect(first[0]).toMatchObject({ state: "ready", text: "The meal contained 42 grams of carbs." });
  await mealInsight("space", "meal", session, input, deps);
  expect(fake.calls).toHaveLength(1);
  expect(deps.emit).toHaveBeenCalledTimes(1);
  await mealInsight(
    "space",
    "meal",
    session,
    { ...input, meal: { ...input.meal, title: "Pasta with cheese" } },
    deps,
  );
  expect(fake.calls).toHaveLength(2);
  expect(deps.emit).toHaveBeenCalledTimes(2);
});
it("does not generate incomplete observations and maps provider failure states", async () => {
  const { fake, deps } = setup();
  expect(
    await mealInsight(
      "space",
      "meal",
      session,
      { ...input, stats: { ...input.stats, inRange: { ...input.stats.inRange, complete: false } } },
      deps,
    ),
  ).toEqual({ state: "pending" });
  expect(fake.calls).toHaveLength(0);
  for (const [code, state] of [
    ["ai-disabled", "off"],
    ["ai-cap-reached", "cap"],
    ["ai-unavailable", "unavailable"],
    ["ai-rejected", "unavailable"],
  ] as const) {
    expect(
      await mealInsight("space", "meal", session, input, {
        ...deps,
        provider: () => {
          throw new HttpError(503, code);
        },
      }),
    ).toEqual({ state });
  }
});
it("keeps both locales cached when clients refetch each other's creation events", async () => {
  const { fake, deps } = setup();
  const danish = { ...input, locale: "da" as const };
  await mealInsight("space", "meal", session, input, deps);
  await mealInsight("space", "meal", { ...session, locale: "da" }, danish, deps);
  await mealInsight("space", "meal", session, input, deps);
  await mealInsight("space", "meal", { ...session, locale: "da" }, danish, deps);
  expect(fake.calls).toHaveLength(2);
  expect(deps.repo.rows).toHaveLength(2);
  for (const call of deps.emit.mock.calls) expect(call[2]).toMatchObject({ subjectKey: "meal" });
});
it("persists the configured provider instead of the capped wrapper identity", async () => {
  const { deps } = setup();
  await mealInsight("space", "meal", session, input, { ...deps, providerName: "anthropic" });
  expect(deps.repo.rows[0]?.provider).toBe("anthropic");
});

it("places the symptoms around the meal in the input, as kind and minutes only, and regenerates when one is added", async () => {
  const { fake, deps } = setup();
  const mealTs = "2026-10-15T10:00:00.000Z";
  let logged = [{ kind: "dizzy", ts: "2026-10-15T11:00:00.000Z", note: "Fictional note" }];
  const withSymptoms = {
    ...deps,
    symptomsAround: () =>
      Promise.resolve({ mealTs, symptoms: logged.map(({ kind, ts }) => ({ kind, ts })) }),
  };
  await mealInsight("space", "meal", session, input, withSymptoms);
  const call = fake.calls[0];
  const content = call?.kind === "complete" ? call.request.messages[0]?.content[0] : undefined;
  if (content?.type !== "text") throw new Error("Expected the narration input");
  const sent = JSON.parse(content.text) as { symptoms?: unknown };
  expect(sent.symptoms).toEqual([{ kind: "dizzy", minutesAfterMeal: 60 }]);
  expect(JSON.stringify(sent.symptoms)).not.toMatch(/mmol|readings|glucose|note|ts"/);
  expect(content.text).not.toMatch(/Fictional|note|2026-10-15T/);
  await mealInsight("space", "meal", session, input, withSymptoms);
  expect(fake.calls).toHaveLength(1);
  logged = [...logged, { kind: "tired", ts: "2026-10-15T12:30:00.000Z", note: "" }];
  await mealInsight("space", "meal", session, input, withSymptoms);
  expect(fake.calls).toHaveLength(2);
  // A symptom outside the window leaves the input, and the hash, as it was without any.
  logged = [{ kind: "tired", ts: "2026-10-15T15:00:00.000Z", note: "" }];
  await mealInsight("space", "meal", session, input, withSymptoms);
  expect(fake.calls).toHaveLength(3);
  await mealInsight("space", "meal", session, input, deps);
  expect(fake.calls).toHaveLength(3);
});

it("narrates without symptoms when they cannot be read, instead of failing the request", async () => {
  // No database behind this test: the default lookup throws inside and answers null.
  expect(await symptomWindowOrNone("space", "meal")).toBeNull();
  const { fake, deps } = setup();
  const result = await mealInsight("space", "meal", session, input, {
    ...deps,
    symptomsAround: symptomWindowOrNone,
  });
  expect(result).toMatchObject({ state: "ready" });
  expect(fake.calls).toHaveLength(1);
});
