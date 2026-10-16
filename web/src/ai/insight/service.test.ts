// @vitest-environment node
import { expect, it, vi } from "vitest";
import { HttpError, SessionContext, type EmitFn } from "@frejsi/shared";
import { FakeAiProvider } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai/capped";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { MemoryInsightRepository } from "@frejsi/shared/insights/memory";
import { buildMealInput } from "@frejsi/shared/ai/insight/input";
import { mealInsight } from "./service";
const session = SessionContext.parse({
  userId: "fictional",
  name: "Fictional member",
  simpleMode: false,
  accent: "olive",
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
    deps: { repo: new MemoryInsightRepository(), emit: vi.fn<EmitFn>(), provider: () => provider },
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
