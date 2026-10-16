import { Food } from "../../schemas/food";
import { lookup } from "../../food/lookup";
import { MemoryFoodRepository } from "../../food/memory";
import { describe, expect, it } from "vitest";
import { FakeAiProvider } from "../fake";
import { CappedAiProvider } from "../capped";
import { MemoryAiCallRepository } from "../calls";
import { parseMeal } from "./parse";
import { parsePrompt } from "./prompt";
import { assertNoDosing } from "../guard";

const candidate = {
  name: "Example apple",
  origin: "off",
  sourceRef: "off:apple",
  carbsPer100g: 12,
  portions: [],
};
const result = { source: "cache", verified: false, food: candidate };
const json = {
  items: [{ query: "apple", match: { source: "cache", food: candidate, grams: 100 } }],
  unmatched: [],
};
const tools = {
  kind: "tool-calls" as const,
  model: "fixture",
  calls: [{ id: "1", name: "lookup", input: { query: "apple" } }],
};
const answer = { kind: "json" as const, model: "fixture", json };

describe("parse meal", () => {
  it("uses the bounded counted loop and returns only foods actually looked up", async () => {
    const fake = new FakeAiProvider([tools, answer]);
    const calls = new MemoryAiCallRepository();
    const provider = new CappedAiProvider(fake, calls, { spaceId: "s1", timezone: "UTC" });
    const queries: string[] = [];
    expect(
      await parseMeal(provider, "apple", "en", (q) => {
        queries.push(q);
        return Promise.resolve({ results: [result], sources: {}, manual: {} });
      }),
    ).toEqual({ meal: json, count: 1 });
    expect(queries).toEqual(["apple"]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toHaveProperty("request.use", "parse");
    expect(fake.calls[1]).toHaveProperty("request.messages.2.content.0.result.results.0", result);
  });
  it("rejects invented matches and a ninth tool call", async () => {
    await expect(
      parseMeal(new FakeAiProvider([answer]), "apple", "en", () => Promise.reject(Error())),
    ).rejects.toMatchObject({ code: "ai-rejected" });
    await expect(
      parseMeal(new FakeAiProvider(Array(9).fill(tools)), "apple", "en", () =>
        Promise.resolve({ results: [], sources: {}, manual: {} }),
      ),
    ).rejects.toMatchObject({ code: "ai-rejected" });
  });
  it("returns lookup errors to the model, permitting an approximate fallback", async () => {
    const meal = {
      items: [
        { query: "apple", estimate: { name: "Apple", carbs: 12, confidence: "low", approx: true } },
      ],
      unmatched: ["bread"],
    };
    const fake = new FakeAiProvider([tools, { ...answer, json: meal }]);
    expect(
      (await parseMeal(fake, "apple and bread", "en", () => Promise.reject(Error("private")))).meal,
    ).toEqual(meal);
    expect(fake.calls[1]).toHaveProperty(
      "request.messages.2.content.0.result.error.code",
      "tool-unavailable",
    );
  });
  it("has safe locale-aware prompts", () => {
    for (const locale of ["da", "en"] as const)
      expect(() => {
        assertNoDosing(parsePrompt(locale), "prompt");
      }).not.toThrow();
    expect(parsePrompt("da")).toContain("Danish");
    expect(parsePrompt("en")).toContain("English");
  });
});

it("keeps three independently looked-up foods and their quantities", async () => {
  const bread = {
    id: "bread",
    name: "Example rye",
    origin: "family",
    portions: [{ label: "2 slices", carbs: 36 }],
    verified: true,
    favourite: false,
    updatedAt: "2026-10-15T10:00:00.000Z",
    createdAt: "2026-10-15T10:00:00.000Z",
  };
  const cheese = {
    ...bread,
    id: "cheese",
    name: "Example cheese",
    portions: [{ label: "1 slice", carbs: 0 }],
  };
  const matches = [
    { query: "rye", match: { source: "library", food: bread, portionLabel: "2 slices" } },
    { query: "cheese", match: { source: "library", food: cheese, portionLabel: "1 slice" } },
    { query: "apple", match: { source: "cache", food: candidate, grams: 120 } },
  ];
  const fake = new FakeAiProvider([
    {
      ...tools,
      calls: matches.map((item, i) => ({
        id: String(i),
        name: "lookup",
        input: { query: item.query },
      })),
    },
    { ...answer, json: { items: matches, unmatched: [] } },
  ]);
  const rows = matches.map((item) => ({
    source: item.match.source,
    verified: item.match.source === "library",
    food: item.match.food,
  }));
  const calls = new MemoryAiCallRepository();
  const result = await parseMeal(
    new CappedAiProvider(fake, calls, { spaceId: "s1", timezone: "UTC" }),
    "two slices of rye with cheese and an apple",
    "en",
    (q) =>
      Promise.resolve({
        results: rows.filter((_, i) => matches[i]?.query === q),
        sources: {},
        manual: {},
      }),
  );
  expect(result).toEqual({ meal: { items: matches, unmatched: [] }, count: 3 });
  expect(calls.rows.map((row) => ({ use: row.use, ok: row.ok }))).toEqual([
    { use: "parse", ok: true },
    { use: "parse", ok: true },
  ]);
});

it("accepts a real lookup match after its optional fields cross the JSON tool boundary", async () => {
  const row = Food.parse({
    id: "bread",
    spaceId: "s1",
    name: "Example rye",
    nameSearch: "example rye",
    sourceRef: "family:bread",
    origin: "family",
    portions: [{ label: "1 slice", carbs: 18 }],
    verified: true,
    favourite: false,
    updatedAt: "2026-10-15T10:00:00.000Z",
    createdAt: "2026-10-15T10:00:00.000Z",
  });
  const response = await lookup(new MemoryFoodRepository([row]), [], {
    spaceId: "s1",
    session: { simpleMode: false },
    locale: "en",
    query: { q: "rye", remote: true },
  });
  const food = response.results[0]?.food;
  if (!food) throw new Error("Expected a library result");
  expect(Object.keys(food)).toContain("sourceName");
  const wireMeal: unknown = JSON.parse(
    JSON.stringify({
      items: [{ query: "bread", match: { source: "library", food, portionLabel: "1 slice" } }],
      unmatched: [],
    }),
  );
  const fake = new FakeAiProvider([
    { ...tools, calls: [{ id: "1", name: "lookup", input: { query: "bread" } }] },
    { ...answer, json: wireMeal },
  ]);
  expect((await parseMeal(fake, "bread", "en", () => Promise.resolve(response))).meal).toEqual(
    wireMeal,
  );
});

it("still rejects changed nutrition on a food the tool actually returned", async () => {
  const fake = new FakeAiProvider([
    tools,
    {
      ...answer,
      json: {
        items: [
          {
            query: "apple",
            match: { source: "cache", food: { ...candidate, carbsPer100g: 99 }, grams: 100 },
          },
        ],
        unmatched: [],
      },
    },
  ]);
  await expect(
    parseMeal(fake, "apple", "en", () =>
      Promise.resolve({ results: [result], sources: {}, manual: {} }),
    ),
  ).rejects.toMatchObject({ code: "ai-rejected" });
});
