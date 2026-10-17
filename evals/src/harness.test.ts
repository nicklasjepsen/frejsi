import { expect, it, vi } from "vitest";
import { aiProviders } from "@frejsi/shared/ai";
import { loadCases, type EvalCase } from "./cases";
import { execute, runSet } from "./harness";
import { type RunBudget } from "./budget";

const fake = (c: EvalCase) => {
  const p = aiProviders({ FAKE_AI_PROVIDER: "1" }, { fakeScript: c.recorded }).anthropic;
  if (!p) throw new Error("missing fake");
  return p;
};
it("runs the entire recorded fake corpus, scores it and prints the missing-key and pending lines", async () => {
  const log = vi.fn<(text: string) => void>();
  const live = vi.fn();
  const result = await execute({}, log, live);
  expect(live).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith("live evals skipped: no ANTHROPIC_API_KEY");
  expect(log).toHaveBeenCalledWith("5 photo cases pending an image");
  expect(log).toHaveBeenCalledWith("1 recipe photo case pending an image");
  expect(result.fake.scores).toMatchObject({
    parseRecall: 1,
    parsePortions: 1,
    normaliseAccuracy: 1,
    photoCount: 0,
    recipeAccuracy: 1,
    recipeCount: 5,
  });
  expect(result.fake.completed).toBe(60);
  expect(result.fake.pendingRecipes).toBe(1);
});
it("runs a JSON-LD recipe case through no provider at all, and a text case through one counted call", async () => {
  const cases = await loadCases();
  const page = cases.find((c) => c.kind === "recipe" && c.html !== undefined);
  const text = cases.find((c) => c.kind === "recipe" && c.text !== undefined);
  if (!page || !text) throw new Error("missing recipe cases");
  const factory = vi.fn(fake);
  const result = await runSet([page], factory);
  expect(factory).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    completed: 1,
    calls: 0,
    scores: { recipeAccuracy: 1, recipeCount: 1 },
  });
  const typed = await runSet([text], factory);
  expect(factory).toHaveBeenCalledOnce();
  expect(typed).toMatchObject({ completed: 1, calls: 1, scores: { recipeAccuracy: 1 } });
  const wrong = {
    ...text,
    recorded: [
      {
        kind: "json" as const,
        model: "fixture",
        json: { title: "Nothing", ingredients: [], yieldPortions: 1 },
      },
    ],
  };
  await expect(runSet([wrong], fake)).rejects.toThrow("recipeAccuracy");
});
it("uses the keyed factory only after fake success, respects scope and accepts the evals secret alias", async () => {
  const live = vi.fn((_key: string, _budget: RunBudget) => fake);
  const result = await execute(
    { ANTHROPIC_API_KEY_EVALS: "fictional-key", EVALS_SCOPE: "pr" },
    () => undefined,
    live,
  );
  expect(live).toHaveBeenCalledOnce();
  expect(result.live?.completed).toBe(55);
  await expect(execute({ EVALS_SCOPE: "typo" }, () => undefined, live)).rejects.toThrow("scope");
});
it("fails malformed output, missing items, a swallowed cap error, and rejected raw insight before retries hide it", async () => {
  const cases = await loadCases();
  const parse = cases.find((c) => c.kind === "parse");
  const meal = cases.find((c) => c.kind === "meal");
  if (!parse || !meal) throw Error("missing fixtures");
  for (const c of [
    {
      ...parse,
      recorded: [{ kind: "json" as const, model: "fixture", json: { items: [], unmatched: [] } }],
    },
    { ...parse, recorded: [{ kind: "json" as const, model: "fixture", json: {} }] },
    {
      ...meal,
      recorded: [
        {
          kind: "json" as const,
          model: "fixture",
          json: { text: "Toppen var 999 efter måltidet." },
        },
        ...meal.recorded,
      ],
    },
  ])
    await expect(runSet([c], fake)).rejects.toThrow();
  const normalise = cases.find((c) => c.kind === "normalise");
  if (!normalise) throw Error("missing normalise");
  await expect(runSet([normalise, normalise], fake, { maxCalls: 1 })).rejects.toThrow();
});
it("bounds case concurrency to four", async () => {
  const cases = (await loadCases()).filter((c) => c.kind === "normalise");
  let active = 0;
  let maximum = 0;
  await runSet(cases, async (c) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return fake(c);
  });
  expect(maximum).toBe(4);
});

it("scores a ready synthetic photo and applies the corpus floor to a smaller PR subset", async () => {
  const { writeFile, rm } = await import("node:fs/promises");
  const { default: sharp } = await import("sharp");
  const { photoPath } = await import("./photo");
  const filename = "synthetic-eval-test.jpg";
  const file = photoPath(filename);
  const plate = (await loadCases()).find((c) => c.kind === "photo");
  if (!plate) throw new Error("missing photo fixture");
  const c = { ...plate, photo: filename };
  await writeFile(
    file,
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } })
      .jpeg()
      .toBuffer(),
  );
  try {
    expect((await runSet([c], fake)).scores).toMatchObject({ photoCount: 1, photoAccuracy: 1 });
    const bad = {
      ...c,
      recorded: [
        {
          kind: "json" as const,
          model: "fixture",
          json: {
            items: [{ name: "Example plate", carbs: 1, approx: true, confidence: "low" }],
            totalCarbs: 1,
            dishName: "Example plate",
            approx: true,
          },
        },
      ],
    };
    expect((await runSet([bad], fake)).scores.photoAccuracy).toBe(0);
    await expect(runSet([bad], fake, { availablePhotos: 20 })).rejects.toThrow("photoAccuracy");
  } finally {
    await rm(file);
  }
});
it("fails a hanging case within the hard run budget without further provider work", async () => {
  const cases = (await loadCases()).filter((c) => c.kind === "normalise");
  await expect(
    runSet(cases, () => new Promise(() => undefined), { milliseconds: 10 }),
  ).rejects.toThrow("budget");
});
