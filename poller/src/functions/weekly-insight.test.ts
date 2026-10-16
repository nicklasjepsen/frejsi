import { expect, it, vi } from "vitest";
vi.mock("@azure/functions", () => ({ app: { timer: vi.fn() } }));
import { runWeeklyInsights } from "./weekly-insight";
import { MemoryInsightRepository, MemoryWeekSource } from "@frejsi/shared/insights/memory";
import { FakeAiProvider } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai/capped";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { createLogger, type EmitFn } from "@frejsi/shared";
it("isolates failures, logs only codes, and stores each eligible space once", async () => {
  const source = new MemoryWeekSource();
  source.enabledSpaces.push(
    ...["first", "second"].map((id) => ({
      id,
      timezone: "Europe/Copenhagen",
      locale: "en" as const,
      glucoseUnit: "mmol" as const,
      target: { low: 4, high: 10 },
      aiProvider: "anthropic" as const,
    })),
  );
  const repo = new MemoryInsightRepository();
  const lines: string[] = [];
  const fake = new FakeAiProvider([
    {
      kind: "json",
      json: {
        summary: "Recorded meals appear through the week.",
        questions: ["What patterns appeared after lunch?"],
      },
      model: "fixture",
    },
  ]);
  const emit = vi.fn<EmitFn>();
  const deps = {
    source,
    repo,
    emit,
    now: () => new Date("2026-10-18T17:00:00Z"),
    log: createLogger((line) => lines.push(line)),
    provider: (space: { id: string }) => {
      if (space.id === "first") throw new Error("private text");
      return new CappedAiProvider(fake, new MemoryAiCallRepository(), {
        spaceId: space.id,
        timezone: "Europe/Copenhagen",
      });
    },
  };
  await runWeeklyInsights(deps);
  await runWeeklyInsights(deps);
  expect(repo.rows).toHaveLength(1);
  expect(repo.rows[0]?.spaceId).toBe("second");
  expect(fake.calls).toHaveLength(1);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(lines.join()).not.toMatch(/private text|Recorded meals/);
});
it("leaves no cache row after two unsafe summaries and logs ai-rejected only", async () => {
  const source = new MemoryWeekSource();
  source.enabledSpaces.push({
    id: "fictional",
    timezone: "Europe/Copenhagen",
    locale: "en",
    glucoseUnit: "mmol",
    target: { low: 4, high: 10 },
    aiProvider: "anthropic",
  });
  const repo = new MemoryInsightRepository();
  const lines: string[] = [];
  const fake = new FakeAiProvider(() => ({
    kind: "json",
    json: { summary: "Take insulin after this meal.", questions: [] },
    model: "fixture",
  }));
  const emit = vi.fn<EmitFn>();
  await runWeeklyInsights({
    source,
    repo,
    emit,
    now: () => new Date("2026-10-18T17:00:00Z"),
    log: createLogger((line) => {
      lines.push(line);
    }),
    provider: () =>
      new CappedAiProvider(fake, new MemoryAiCallRepository(), {
        spaceId: "fictional",
        timezone: "Europe/Copenhagen",
      }),
  });
  expect(fake.calls).toHaveLength(2);
  expect(repo.rows).toEqual([]);
  expect(emit).not.toHaveBeenCalled();
  expect(lines.join()).toContain('"code":"ai-rejected"');
  expect(lines.join()).not.toContain("insulin");
});
