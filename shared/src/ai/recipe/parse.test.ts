import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RecipeParse } from "../../schemas/ai";
import { MemoryAiCallRepository } from "../calls";
import { CappedAiProvider } from "../capped";
import { FakeAiProvider, defaultFakeAnswer } from "../fake";
import { assertNoDosing } from "../guard";
import { parseRecipe } from "./parse";
import { recipePrompt } from "./prompt";

const fixture = (name: string) =>
  readFileSync(path.resolve(import.meta.dirname, "../../../../fixtures/recipes", name), "utf8");
const capped = (fake: FakeAiProvider, dailyCap = 2) =>
  new CappedAiProvider(fake, new MemoryAiCallRepository(), {
    spaceId: "s1",
    userId: "u1",
    timezone: "UTC",
    dailyCap,
    embedDailyCap: 1,
  });

describe("parseRecipe", () => {
  it("reads a JSON-LD page without touching the provider, even when one is given", async () => {
    const fake = new FakeAiProvider(defaultFakeAnswer);
    const result = await parseRecipe(capped(fake), { kind: "html", html: fixture("lasagne.jsonld.html") }, "da");
    expect(result.approx).toBe(false);
    expect(result.parse.title).toBe("Eksempellasagne");
    expect(result.parse.yieldPortions).toBe(6);
    expect(result.parse.ingredients).toHaveLength(6);
    expect(fake.calls).toHaveLength(0);
    const offline = await parseRecipe(null, { kind: "html", html: fixture("lasagne.jsonld.html") }, "da");
    expect(offline.parse).toEqual(result.parse);
  });
  it("sends a page without JSON-LD to complete as stripped text of at most 12 000 characters, use recipe", async () => {
    const fake = new FakeAiProvider(defaultFakeAnswer);
    const html = `<html><nav>menu</nav><h1>Fictional stew</h1><ul>${"<li>100 g example pasta</li>".repeat(2000)}</ul></html>`;
    const result = await parseRecipe(capped(fake), { kind: "html", html }, "da");
    expect(result.approx).toBe(true);
    expect(RecipeParse.safeParse(result.parse).success).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.kind).toBe("complete");
    if (call?.kind !== "complete") throw new Error("expected a completion");
    expect(call.request).toMatchObject({ role: "everyday", use: "recipe", outputSchema: RecipeParse });
    const sent = call.request.messages[0]?.content[0];
    expect(sent?.type).toBe("text");
    if (sent?.type !== "text") throw new Error("expected text");
    expect(sent.text).not.toContain("<");
    expect(sent.text.length).toBeLessThanOrEqual(12_000);
    expect(sent.text).toContain("Fictional stew");
  });
  it("answers recipe-unreadable for a page without JSON-LD when there is no provider", async () => {
    await expect(
      parseRecipe(null, { kind: "html", html: "<p>no recipe here</p>" }, "da"),
    ).rejects.toMatchObject({ status: 422, code: "recipe-unreadable" });
    await expect(parseRecipe(null, { kind: "text", text: "500 g mel" }, "da")).rejects.toMatchObject({
      status: 409,
      code: "ai-disabled",
    });
  });
  it("sends pasted text to complete and a photo to vision as the estimate does, counted against the cap", async () => {
    const fake = new FakeAiProvider(defaultFakeAnswer);
    const provider = capped(fake, 2);
    const text = await parseRecipe(provider, { kind: "text", text: fixture("lasagne.txt") }, "en");
    expect(text.approx).toBe(true);
    expect(text.parse.ingredients.length).toBeGreaterThan(0);
    const photo = await parseRecipe(provider, { kind: "photo", base64: "YWJj" }, "en");
    expect(photo.approx).toBe(true);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]).toMatchObject({
      kind: "vision",
      request: { role: "everyday", use: "recipe", image: { mediaType: "image/jpeg", base64: "YWJj" } },
    });
    await expect(
      parseRecipe(provider, { kind: "text", text: "1 l vand" }, "en"),
    ).rejects.toMatchObject({ code: "ai-cap-reached" });
    expect(fake.calls).toHaveLength(2);
  });
  it("rejects a non-JSON answer and an answer that does not fit RecipeParse", async () => {
    await expect(
      parseRecipe(
        new FakeAiProvider([{ kind: "text", text: "Example", model: "fixture" }]),
        { kind: "text", text: "1 l vand" },
        "en",
      ),
    ).rejects.toMatchObject({ code: "ai-unavailable" });
    await expect(
      parseRecipe(
        new FakeAiProvider([{ kind: "json", json: { nope: true }, model: "fixture" }]),
        { kind: "text", text: "1 l vand" },
        "en",
      ),
    ).rejects.toMatchObject({ code: "ai-rejected" });
  });
  it("prompts in the requested locale, names only names and amounts, and holds no restricted vocabulary", () => {
    for (const locale of ["da", "en"] as const) {
      const prompt = recipePrompt(locale);
      expect(prompt).toContain(locale);
      expect(prompt).toMatch(/ingredient/i);
      expect(prompt).not.toMatch(/Denmark|Danish|England|English/i);
      expect(() => {
        assertNoDosing(prompt, "prompt");
      }).not.toThrow();
    }
  });
});
