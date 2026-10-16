import { expect, it, vi } from "vitest";
import { MemoryInsightRepository } from "./memory";
import { createInsight, updateInsightQuestions } from "./store";
import type { EmitFn } from "../events/emit";
it("stores unverified text, guards edits, and emits each successful write", async () => {
  const repo = new MemoryInsightRepository();
  const emit = vi.fn<EmitFn>();
  const row = await createInsight(repo, emit, {
    spaceId: "fictional",
    kind: "week",
    subjectKey: "2026-10-12",
    statsHash: "hash",
    text: "The week contains recorded meals.",
    questions: ["What patterns appeared this week?"],
    provider: "fake",
    model: "fixture",
    rejectedCount: 1,
  });
  expect(row.verified).toBe(false);
  expect(emit).toHaveBeenCalledWith("fictional", "insight.created", {
    insightId: row.id,
    kind: "week",
    subjectKey: "2026-10-12",
  });
  const updated = await updateInsightQuestions(repo, emit, row, [
    "What patterns appeared after lunch?",
  ]);
  expect(updated.questionsEdited).toBe(true);
  expect((await repo.find("fictional", "week", "2026-10-12"))?.questions).toEqual([
    "What patterns appeared after lunch?",
  ]);
  expect(emit).toHaveBeenCalledWith("fictional", "insight.updated", { insightId: row.id });
  await expect(
    updateInsightQuestions(repo, emit, row, ["Should I take insulin at lunch?"]),
  ).rejects.toMatchObject({ code: "ai-rejected" });
  expect(emit).toHaveBeenCalledTimes(2);
});
