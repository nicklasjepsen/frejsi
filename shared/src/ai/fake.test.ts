import { describe, expect, it } from "vitest";
import { RecipeParse } from "../schemas/ai";
import { FakeAiProvider, defaultFakeAnswer } from "./fake";

describe("the fake provider's default script", () => {
  it("answers a plausible RecipeParse to a recipe completion and a recipe vision call", async () => {
    const fake = new FakeAiProvider(defaultFakeAnswer);
    const request = { role: "everyday" as const, use: "recipe" as const, system: "x", outputSchema: RecipeParse };
    const completed = await fake.complete({
      ...request,
      messages: [{ role: "user", content: [{ type: "text", text: "500 g mel" }] }],
    });
    const seen = await fake.vision({
      ...request,
      prompt: "read",
      image: { mediaType: "image/jpeg", base64: "YWJj" },
    });
    for (const answer of [completed, seen]) {
      expect(answer.kind).toBe("json");
      if (answer.kind !== "json") throw new Error("expected json");
      const parsed = RecipeParse.parse(answer.json);
      expect(parsed.ingredients.length).toBeGreaterThan(1);
      expect(parsed.yieldPortions).toBeGreaterThan(0);
      expect(parsed.ingredients.some((line) => line.unit === "g")).toBe(true);
    }
  });
  it("still answers the earlier schemas with their own samples", async () => {
    const { PhotoEstimate, NormalisedFood } = await import("../schemas/ai");
    const fake = new FakeAiProvider(defaultFakeAnswer);
    const estimate = await fake.vision({
      role: "everyday",
      use: "estimate",
      system: "x",
      prompt: "x",
      image: { mediaType: "image/jpeg", base64: "YWJj" },
      outputSchema: PhotoEstimate,
    });
    expect(estimate).toMatchObject({ kind: "json", json: { dishName: "Example dish" } });
    const name = await fake.complete({
      role: "small",
      use: "normalise",
      system: "x",
      messages: [],
      outputSchema: NormalisedFood,
    });
    expect(name).toMatchObject({ kind: "json", json: { name: "Example loaf" } });
  });
});
