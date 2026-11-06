import { ParsedMeal, ParsedMealDraft } from "../../schemas/ai";
import { Food } from "../../schemas/food";
import { lookup } from "../../food/lookup";
import { MemoryFoodRepository } from "../../food/memory";
import { describe, expect, it, vi } from "vitest";
import { FakeAiProvider, defaultFakeAnswer } from "../fake";
import { CappedAiProvider } from "../capped";
import { MemoryAiCallRepository } from "../calls";
import { parseMeal } from "./parse";
import { parsePrompt } from "./prompt";
import { LookupInput } from "./tool";
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
  items: [{ query: "apple", match: { source: "cache", foodRef: "off:apple", grams: 100 } }],
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
    ).toEqual({
      meal: {
        items: [{ query: "apple", match: { source: "cache", food: candidate, grams: 100 } }],
        unmatched: [],
      },
      count: 1,
    });
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
    const fake = new FakeAiProvider([
      { ...tools, calls: [...tools.calls, { id: "2", name: "lookup", input: { query: "bread" } }] },
      { ...answer, json: meal },
    ]);
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
    {
      ...answer,
      json: {
        items: matches.map(({ query, match: { food, ...match } }) => ({
          query,
          match: { ...match, foodRef: "id" in food ? food.id : food.sourceRef },
        })),
        unmatched: [],
      },
    },
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

it("returns the lookup row's own food for a reference, not anything the model wrote", async () => {
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
  const fake = new FakeAiProvider([
    { ...tools, calls: [{ id: "1", name: "lookup", input: { query: "bread" } }] },
    {
      ...answer,
      json: {
        items: [
          {
            query: "bread",
            match: { source: "library", foodRef: "bread", portionLabel: "1 slice" },
          },
        ],
        unmatched: [],
      },
    },
  ]);
  const { meal } = await parseMeal(fake, "bread", "en", () => Promise.resolve(response));
  expect(meal.items[0]?.match).toEqual({ source: "library", food, portionLabel: "1 slice" });
  expect(ParsedMeal.safeParse(meal).success).toBe(true);
});

it("rejects a model answer that writes a food instead of naming a lookup row", async () => {
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

it("accepts a row found under different words than the item's query", async () => {
  const fake = new FakeAiProvider([
    tools,
    {
      ...answer,
      json: {
        items: [
          { query: "a red apple", match: { source: "cache", foodRef: "off:apple", grams: 100 } },
        ],
        unmatched: [],
      },
    },
  ]);
  const { meal } = await parseMeal(fake, "a red apple", "en", () =>
    Promise.resolve({ results: [result], sources: {}, manual: {} }),
  );
  expect(meal.items[0]).toEqual({
    query: "a red apple",
    match: { source: "cache", food: candidate, grams: 100 },
  });
});

it("rejects a reference to a row lookup did not return, or from another source", async () => {
  for (const match of [
    { source: "cache", foodRef: "off:banana", grams: 100 },
    { source: "library", foodRef: "off:apple", grams: 100 },
  ]) {
    const fake = new FakeAiProvider([
      tools,
      { ...answer, json: { items: [{ query: "apple", match }], unmatched: [] } },
    ]);
    await expect(
      parseMeal(fake, "apple", "en", () =>
        Promise.resolve({ results: [result], sources: {}, manual: {} }),
      ),
    ).rejects.toMatchObject({ code: "ai-rejected" });
  }
});

it("rejects estimates without a lookup and when lookup found a food", async () => {
  const estimated = {
    ...answer,
    json: {
      items: [
        { query: "apple", estimate: { name: "Apple", carbs: 12, confidence: "low", approx: true } },
      ],
      unmatched: [],
    },
  };
  for (const script of [[estimated], [tools, estimated]]) {
    await expect(
      parseMeal(new FakeAiProvider(script), "apple", "en", () =>
        Promise.resolve({ results: [result], sources: {}, manual: {} }),
      ),
    ).rejects.toMatchObject({ code: "ai-rejected" });
  }
});
it("accepts estimates only after an empty lookup for that same query", async () => {
  const estimated = {
    ...answer,
    json: {
      items: [
        { query: "apple", estimate: { name: "Apple", carbs: 12, confidence: "low", approx: true } },
      ],
      unmatched: [],
    },
  };
  expect(
    (
      await parseMeal(new FakeAiProvider([tools, estimated]), "apple", "en", () =>
        Promise.resolve({ results: [], sources: {}, manual: {} }),
      )
    ).meal,
  ).toEqual(estimated.json);
  const unrelated = { ...tools, calls: [{ id: "1", name: "lookup", input: { query: "bread" } }] };
  await expect(
    parseMeal(new FakeAiProvider([unrelated, estimated]), "apple", "en", () =>
      Promise.resolve({ results: [], sources: {}, manual: {} }),
    ),
  ).rejects.toMatchObject({ code: "ai-rejected" });
});

it("keeps the default fake usable through the same lookup gate", async () => {
  const fake = new FakeAiProvider(defaultFakeAnswer);
  const result = await parseMeal(fake, "Example pasta", "en", () =>
    Promise.resolve({ results: [], sources: {}, manual: {} }),
  );
  expect(result.count).toBe(1);
  expect(result.meal.items[0]).toMatchObject({
    query: "Example pasta",
    estimate: { approx: true },
  });
  expect(fake.calls).toHaveLength(2);
});

it("lets the default fake name a found row, so local and e2e Say entry still match", async () => {
  const { meal } = await parseMeal(new FakeAiProvider(defaultFakeAnswer), "pasta", "en", () =>
    Promise.resolve({
      results: [{ source: "off", verified: false, food: { ...candidate, sourceRef: "off:pasta" } }],
      sources: {},
      manual: {},
    }),
  );
  expect(meal.items[0]?.match?.food).toMatchObject({ sourceRef: "off:pasta", carbsPer100g: 12 });
});

describe("a feeling said at the table (v0.6.0 plan §5)", () => {
  const banana = {
    name: "Example banana",
    origin: "off",
    sourceRef: "off:banana",
    carbsPer100g: 20,
    portions: [],
  };
  const bananaRow = { source: "cache", verified: false, food: banana };
  const lookupBanana = (q: string) =>
    Promise.resolve({
      results: q === "banana" ? [bananaRow] : [],
      sources: {},
      manual: {},
    });
  it("returns one banana item and one stomach-ache symptom for 'jeg har ondt i maven og spiste en banan'", async () => {
    const draft = {
      items: [{ query: "banana", match: { source: "cache", foodRef: "off:banana", grams: 120 } }],
      unmatched: [],
      symptoms: [{ kind: "stomach-ache" }],
    };
    const meal = {
      ...draft,
      items: [{ query: "banana", match: { source: "cache", food: banana, grams: 120 } }],
    };
    const fake = new FakeAiProvider([
      { ...tools, calls: [{ id: "1", name: "lookup", input: { query: "banana" } }] },
      { ...answer, json: draft },
    ]);
    const result = await parseMeal(
      fake,
      "jeg har ondt i maven og spiste en banan",
      "da",
      lookupBanana,
    );
    expect(result).toEqual({ meal, count: 1 });
    expect(result.meal.items).toHaveLength(1);
    expect(result.meal.symptoms).toEqual([{ kind: "stomach-ache" }]);
  });
  it("returns no items and one dizzy symptom for 'jeg er svimmel', without a lookup", async () => {
    const meal = { items: [], unmatched: [], symptoms: [{ kind: "dizzy" }] };
    const fake = new FakeAiProvider([{ ...answer, json: meal }]);
    const lookup = vi.fn(lookupBanana);
    expect(await parseMeal(fake, "jeg er svimmel", "da", lookup)).toEqual({ meal, count: 0 });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("rejects a symptom kind the model made up", async () => {
    const fake = new FakeAiProvider([
      { ...answer, json: { items: [], unmatched: [], symptoms: [{ kind: "sad" }] } },
    ]);
    await expect(parseMeal(fake, "jeg er ked af det", "da", lookupBanana)).rejects.toMatchObject({
      code: "ai-rejected",
    });
  });
  it("names the six kinds in the prompt so the model picks from them, in both locales", () => {
    for (const locale of ["da", "en"] as const) {
      const prompt = parsePrompt(locale);
      for (const kind of ["stomach-ache", "dizzy", "nausea", "tired", "headache", "shaky"])
        expect(prompt).toContain(kind);
      expect(prompt).toMatch(/symptoms/);
    }
  });
  it("still validates the fake provider's default parse answer", () => {
    const final = defaultFakeAnswer({
      kind: "complete",
      request: {
        role: "everyday",
        use: "parse",
        system: parsePrompt("da"),
        tools: [{ name: "lookup", description: "", inputSchema: LookupInput }],
        messages: [
          { role: "user", content: [{ type: "text", text: "jeg er svimmel" }] },
          {
            role: "assistant",
            content: [
              { type: "tool-call", id: "fixture-lookup", name: "lookup", input: { query: "x" } },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool-result",
                toolCallId: "fixture-lookup",
                result: { results: [], sources: {}, manual: {} },
              },
            ],
          },
        ],
      },
    });
    expect(final).toMatchObject({ kind: "json" });
    expect(ParsedMealDraft.safeParse((final as { json: unknown }).json).success).toBe(true);
  });
});

it("keeps the looked-up row when an item comes back with an estimate as well", async () => {
  const both = {
    ...answer,
    json: {
      items: [
        {
          query: "apple",
          match: { source: "cache", foodRef: "off:apple", grams: 100 },
          estimate: { name: "Apple", carbs: 12, confidence: "low", approx: true },
        },
      ],
      unmatched: [],
    },
  };
  const { meal } = await parseMeal(
    new CappedAiProvider(new FakeAiProvider([tools, both]), new MemoryAiCallRepository(), {
      spaceId: "s1",
      timezone: "UTC",
    }),
    "apple",
    "en",
    () => Promise.resolve({ results: [result], sources: {}, manual: {} }),
  );
  expect(meal.items).toEqual([
    { query: "apple", match: { source: "cache", food: candidate, grams: 100 } },
  ]);
});

it("leaves an item with neither a match nor an estimate unmatched, if it was searched", async () => {
  const neither = { ...answer, json: { items: [{ query: "apple" }], unmatched: [] } };
  const empty = () => Promise.resolve({ results: [], sources: {}, manual: {} });
  expect(
    (await parseMeal(new FakeAiProvider([tools, neither]), "apple", "en", empty)).meal,
  ).toEqual({ items: [], unmatched: ["apple"] });
  await expect(
    parseMeal(new FakeAiProvider([neither]), "apple", "en", empty),
  ).rejects.toMatchObject({ code: "ai-rejected" });
});
