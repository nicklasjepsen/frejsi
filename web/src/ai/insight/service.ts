import { createHash } from "node:crypto";
import { emit, HttpError, type EmitFn, type SessionContext } from "@frejsi/shared";
import { type AiProvider } from "@frejsi/shared/ai";
import type { InsightInput, MealInsightView } from "@frejsi/shared/schemas/ai";
import { narrateMeal } from "@frejsi/shared/ai/insight/meal";
import { createInsight, PrismaInsightRepository } from "@frejsi/shared/insights/store";
import type { InsightRepository } from "@frejsi/shared/insights/types";
import { aiForSpace } from "../provider";
export interface InsightDeps {
  repo: InsightRepository;
  emit: EmitFn;
  provider: (spaceId: string, session: SessionContext) => AiProvider | Promise<AiProvider>;
}
let overrides: Partial<InsightDeps> = {};
export function configureInsights(deps: Partial<InsightDeps>) {
  overrides = deps;
}
export function insightDeps(): InsightDeps {
  return {
    repo: overrides.repo ?? new PrismaInsightRepository(),
    emit: overrides.emit ?? emit,
    provider: overrides.provider ?? aiForSpace,
  };
}
export function insightState(error: unknown): MealInsightView["state"] | null {
  if (!(error instanceof HttpError)) return null;
  if (error.code === "ai-disabled") return "off";
  if (error.code === "ai-cap-reached") return "cap";
  if (["ai-unavailable", "ai-not-configured", "ai-rejected"].includes(error.code))
    return "unavailable";
  return null;
}
const pending = new Map<string, Promise<MealInsightView>>();
export async function mealInsight(
  spaceId: string,
  mealId: string,
  session: SessionContext,
  input: InsightInput,
  deps = insightDeps(),
): Promise<MealInsightView> {
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const subjectKey = `${mealId}:${input.locale}`;
  const key = `${spaceId}:${subjectKey}:${hash}`;
  const running = pending.get(key);
  if (running) return running;
  const work = async (): Promise<MealInsightView> => {
    try {
      const provider = await deps.provider(spaceId, session);
      if (!input.stats.inRange.complete) return { state: "pending" };
      const cached = await deps.repo.find(spaceId, "meal", subjectKey);
      if (cached?.statsHash === hash)
        return {
          state: "ready",
          text: cached.text,
          createdAt: cached.createdAt.toISOString(),
          model: cached.model,
        };
      const result = await narrateMeal(provider, input);
      const row = await createInsight(
        deps.repo,
        deps.emit,
        {
          spaceId,
          kind: "meal",
          subjectKey,
          statsHash: hash,
          text: result.text,
          questions: [],
          rejectedCount: 0,
          provider: provider.id,
          model: result.model,
        },
        mealId,
      );
      return {
        state: "ready",
        text: row.text,
        createdAt: row.createdAt.toISOString(),
        model: row.model,
      };
    } catch (error) {
      const state = insightState(error);
      if (state) return { state };
      throw error;
    }
  };
  const promise = work();
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    pending.delete(key);
  }
}
