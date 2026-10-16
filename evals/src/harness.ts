import { readFile } from "node:fs/promises";
import {
  aiProviders,
  CappedAiProvider,
  type AiProvider,
  type CompleteResult,
} from "@frejsi/shared/ai";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { parseMeal } from "@frejsi/shared/ai/parse/parse";
import { estimatePhoto } from "@frejsi/shared/ai/estimate/estimate";
import { narrateMeal } from "@frejsi/shared/ai/insight/meal";
import { narrateWeek } from "@frejsi/shared/ai/insight/week";
import { narrationInput } from "@frejsi/shared/ai/insight/numbers";
import { normaliseFoodName } from "@frejsi/shared/ai/search/normalise";
import { foldForSearch } from "@frejsi/shared/food/search";
import { LookupResponse } from "@frejsi/shared/schemas/food";
import { PhotoEstimate } from "@frejsi/shared/schemas/ai";
import library from "../fixtures/library.json";
import { loadCases, selectCases, type EvalCase } from "./cases";
import { RunBudget, type BudgetOptions } from "./budget";
import { photoPath } from "./photo";
import {
  checkStrings,
  checkInsight,
  scoreParse,
  enforceThresholds,
  within,
  type Scores,
} from "./score";

type Factory = (c: EvalCase) => AiProvider | Promise<AiProvider>;
type LiveFactory = (key: string, budget: RunBudget) => Factory;
export interface Report {
  completed: number;
  pending: number;
  calls: number;
  scores: Scores;
}
const ratio = (n: number, d: number) => (d ? n / d : 1);
const aliases: Record<string, string> = {
  spagetti: "pasta bolognese",
  spageti: "pasta bolognese",
  spaghetti: "pasta bolognese",
  ost: "rugbrod med ost",
  kartofler: "kartoffel kogt",
};
function lookup(query: string) {
  const folded = foldForSearch(query);
  const key = aliases[folded] ?? folded;
  return Promise.resolve(
    LookupResponse.parse({
      results: library.filter(
        (row) =>
          foldForSearch(row.food.name).includes(key) || key.includes(foldForSearch(row.food.name)),
      ),
      sources: {},
      manual: {},
    }),
  );
}
function audited(inner: AiProvider, c: EvalCase, violations: string[]): AiProvider {
  const audit = (answer: CompleteResult) => {
    try {
      checkStrings(answer);
      if ((c.kind === "meal" || c.kind === "week") && answer.kind === "json")
        checkInsight(answer.json, narrationInput(c.input));
    } catch {
      violations.push(c.id);
      throw new Error("unsafe eval output");
    }
    return answer;
  };
  return {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    complete: async (req) => audit(await inner.complete(req)),
    vision: async (req) => audit(await inner.vision(req)),
    embed: (req) => inner.embed(req),
  };
}
export async function runSet(
  cases: EvalCase[],
  factory: Factory,
  options: BudgetOptions & { availablePhotos?: number } = {},
  existingBudget?: RunBudget,
): Promise<Report> {
  const budget = existingBudget ?? new RunBudget(options);
  const calls = new MemoryAiCallRepository();
  const violations: string[] = [];
  const failures: string[] = [];
  let expected = 0,
    found = 0,
    portions = 0,
    expectedUnmatched = 0,
    unmatched = 0,
    normalise = 0,
    normalised = 0,
    photos = 0,
    photoCorrect = 0,
    completed = 0,
    pending = 0;
  let cursor = 0;
  const work = async () => {
    for (;;) {
      budget.check();
      const c = cases[cursor++];
      if (!c) return;
      if (c.kind === "photo" && c.photo === "pending") {
        // Pending plates have no image to evaluate; still validate/guard the recorded contract.
        for (const answer of c.recorded) {
          if (answer.kind !== "json") throw new Error("invalid pending fixture");
          checkStrings(PhotoEstimate.parse(answer.json));
        }
        pending++;
        continue;
      }
      try {
        const provider = new CappedAiProvider(audited(await factory(c), c, violations), calls, {
          spaceId: "fictional-eval",
          timezone: "UTC",
          dailyCap: budget.maxCalls,
        });
        if (c.kind === "parse") {
          const { meal } = await parseMeal(provider, c.text, c.locale, lookup);
          const score = scoreParse(c.expected, c.unmatched, meal);
          expected += score.expected;
          found += score.found;
          portions += score.portions;
          unmatched += score.unmatched;
          expectedUnmatched += score.expectedUnmatched;
        } else if (c.kind === "normalise") {
          const result = await normaliseFoodName(provider, c.name, c.locale);
          normalise++;
          if (!result) throw new Error("normalisation failed");
          checkStrings(result);
          if (foldForSearch(result.name).includes(foldForSearch(c.expected))) normalised++;
        } else if (c.kind === "meal") {
          const { text } = await narrateMeal(provider, c.input);
          checkInsight({ text }, narrationInput(c.input));
        } else if (c.kind === "week") {
          const { summary, questions, rejectedCount } = await narrateWeek(provider, c.input);
          checkInsight({ summary, questions }, narrationInput(c.input));
          if (rejectedCount) throw new Error("weekly questions rejected");
        } else {
          const result = await estimatePhoto(
            provider,
            (await readFile(photoPath(c.photo))).toString("base64"),
            c.locale,
          );
          checkStrings(result);
          photos++;
          if (
            within(
              result.totalCarbs,
              c.items.reduce((sum, item) => sum + item.carbs, 0),
              0.3,
            )
          )
            photoCorrect++;
        }
        budget.check();
        completed++;
      } catch {
        failures.push(c.id);
      }
    }
  };
  return budget.run(async () => {
    await Promise.all(Array.from({ length: 4 }, work));
    budget.check();
    if (calls.rows.length > budget.maxCalls) throw new Error("eval call cap exceeded");
    if (violations.length || failures.length)
      throw new Error(
        `eval cases failed: ${[...new Set([...violations, ...failures])].join(", ")}`,
      );
    const scores = {
      parseRecall: ratio(found, expected),
      parsePortions: ratio(portions, found),
      photoAccuracy: ratio(photoCorrect, photos),
      photoCount: photos,
      normaliseAccuracy: ratio(normalised, normalise),
      unmatchedAccuracy: ratio(unmatched, expectedUnmatched),
    };
    enforceThresholds(scores, options.availablePhotos);
    return { completed, pending, calls: calls.rows.length, scores };
  });
}
const recorded: Factory = (c) => {
  const provider = aiProviders({ FAKE_AI_PROVIDER: "1" }, { fakeScript: c.recorded }).anthropic;
  if (!provider) throw new Error("fake provider unavailable");
  return provider;
};
const liveFactory: LiveFactory = (key, budget) => {
  const provider = aiProviders(
    { ANTHROPIC_API_KEY: key },
    { fetch: budget.fetch, timeout: Math.max(1, budget.deadline - Date.now()) },
  ).anthropic;
  if (!provider) throw new Error("live provider unavailable");
  return () => provider;
};
export async function execute(
  env: Readonly<Record<string, string | undefined>>,
  log: (message: string) => void,
  live: LiveFactory = liveFactory,
): Promise<{ fake: Report; live?: Report }> {
  const scope = env.EVALS_SCOPE ?? "pr";
  if (scope !== "pr" && scope !== "release") throw new Error("invalid eval scope");
  const cases = await loadCases();
  const fake = await runSet(cases, recorded);
  log(`${fake.pending} photo cases pending an image`);
  log(`fake evals: ${JSON.stringify(fake)}`);
  const key = [env.ANTHROPIC_API_KEY_EVALS, env.ANTHROPIC_API_KEY].find((value) => value?.trim());
  if (!key) {
    log("live evals skipped: no ANTHROPIC_API_KEY");
    return { fake };
  }
  const budget = new RunBudget();
  try {
    const report = await runSet(
      selectCases(cases, scope),
      live(key, budget),
      { availablePhotos: cases.filter((c) => c.kind === "photo" && c.photo !== "pending").length },
      budget,
    );
    log(`live evals (${scope}): ${JSON.stringify(report)}`);
    return { fake, live: report };
  } finally {
    budget.close();
  }
}
