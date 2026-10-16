import { describe, expect, it } from "vitest";
import { FakeAiProvider, defaultFakeAnswer } from "../fake";
import { CappedAiProvider } from "../capped";
import { MemoryAiCallRepository } from "../calls";
import { assertNoDosing } from "../guard";
import { estimatePhoto } from "./estimate";
import { estimatePrompt } from "./prompt";

describe("plate estimate", () => {
  it("uses one counted everyday vision call with only the photo and locale", async () => {
    const fake = new FakeAiProvider(defaultFakeAnswer);
    const calls = new MemoryAiCallRepository();
    const provider = new CappedAiProvider(fake, calls, {
      spaceId: "s1",
      userId: "u1",
      timezone: "UTC",
      dailyCap: 1,
      embedDailyCap: 1,
    });
    const result = await estimatePhoto(provider, "YWJj", "en");
    expect(result).toMatchObject({ approx: true, totalCarbs: 30 });
    expect(Number.isInteger(result.items[0]?.carbs)).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      kind: "vision",
      request: {
        role: "everyday",
        use: "estimate",
        image: { mediaType: "image/jpeg", base64: "YWJj" },
      },
    });
    await expect(estimatePhoto(provider, "YWJj", "en")).rejects.toMatchObject({
      code: "ai-cap-reached",
    });
    expect(fake.calls).toHaveLength(1);
  });
  it("prompts in the requested locale without a country or restricted vocabulary", () => {
    for (const locale of ["da", "en"] as const) {
      const prompt = estimatePrompt(locale);
      expect(prompt).toContain(locale);
      expect(prompt).toContain("portions in grams");
      expect(prompt).not.toMatch(/Denmark|Danish|England|English/i);
      expect(() => { assertNoDosing(prompt, "prompt"); }).not.toThrow();
    }
  });
  it("rejects a non-JSON response and inconsistent totals", async () => {
    await expect(
      estimatePhoto(
        new FakeAiProvider([{ kind: "text", text: "Example", model: "fixture" }]),
        "YWJj",
        "en",
      ),
    ).rejects.toMatchObject({ code: "ai-unavailable" });
    const fake = new FakeAiProvider([
      {
        kind: "json",
        model: "fixture",
        json: {
          dishName: "Example",
          approx: true,
          totalCarbs: 9,
          items: [{ name: "Pear", carbs: 8, approx: true, confidence: "low" }],
        },
      },
    ]);
    await expect(estimatePhoto(fake, "YWJj", "en")).rejects.toMatchObject({ code: "ai-rejected" });
  });
});

it("the request contract accepts an 8 MiB JPEG encoded as base64 without recursive matching", async () => {
  const { EstimateRequest } = await import("../../schemas/ai");
  const photoDataUrl = `data:image/jpeg;base64,${Buffer.alloc(8 * 1024 * 1024).toString("base64")}`;
  expect(EstimateRequest.safeParse({ photoDataUrl }).success).toBe(true);
  expect(EstimateRequest.safeParse({ photoDataUrl: "data:image/jpeg;base64,AA=A" }).success).toBe(
    false,
  );
});
