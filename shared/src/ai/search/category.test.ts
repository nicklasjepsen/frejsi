import { expect, it } from "vitest";
import { CappedAiProvider } from "../capped";
import { MemoryAiCallRepository } from "../calls";
import { FakeAiProvider } from "../fake";
import { assertNoDosing } from "../guard";
import { categoriseFood, FoodCategoryAnswer } from "./category";
import { CATEGORY_PROMPT } from "./prompt";

it("categorisation is a guarded, capped small call under the normalise use, answering exactly a category", async () => {
  const fake = new FakeAiProvider([
    { kind: "json", model: "fixture", json: { category: "bread" } },
    { kind: "json", model: "fixture", json: { category: "loaf" } },
    { kind: "json", model: "fixture", json: { category: "bread", note: "extra" } },
    { kind: "text", model: "fixture", text: "bread" },
  ]);
  const calls = new MemoryAiCallRepository();
  const provider = new CappedAiProvider(fake, calls, {
    spaceId: "s1",
    timezone: "UTC",
    dailyCap: 4,
  });
  expect(await categoriseFood(provider, "Fiktivt rugbrød", "da")).toBe("bread");
  expect(fake.calls[0]).toMatchObject({
    kind: "complete",
    request: {
      role: "small",
      use: "normalise",
      system: CATEGORY_PROMPT,
      outputSchema: FoodCategoryAnswer,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify({ name: "Fiktivt rugbrød", locale: "da" }) },
          ],
        },
      ],
    },
  });
  // Anything but one of the ten categories is no answer; the cap is still spent.
  expect(await categoriseFood(provider, "Fiktiv kage", "da")).toBeNull();
  expect(await categoriseFood(provider, "Fiktiv kage", "da")).toBeNull();
  expect(await categoriseFood(provider, "Fiktiv kage", "da")).toBeNull();
  // The cap is spent: no call reaches the model, no throw reaches the caller.
  expect(await categoriseFood(provider, "Fiktiv drik", "en")).toBeNull();
  expect(fake.calls).toHaveLength(4);
  expect(calls.rows).toHaveLength(5);
  expect(FoodCategoryAnswer.safeParse({ category: "mixed" }).success).toBe(true);
  expect(FoodCategoryAnswer.safeParse({ category: "unknown" }).success).toBe(false);
  expect(() => {
    assertNoDosing(CATEGORY_PROMPT, "prompt");
  }).not.toThrow();
});
