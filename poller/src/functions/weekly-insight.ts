import { app } from "@azure/functions";
import { createHash } from "node:crypto";
import { emit, HttpError, log, prisma, type EmitFn, type Logger } from "@frejsi/shared";
import {
  aiProviders,
  CappedAiProvider,
  PrismaAiCallRepository,
  type AiProvider,
} from "@frejsi/shared/ai";
import { narrateWeek } from "@frejsi/shared/ai/insight/week";
import { createInsight, PrismaInsightRepository } from "@frejsi/shared/insights/store";
import type { InsightRepository } from "@frejsi/shared/insights/types";
import {
  buildWeekInsightInput,
  PrismaWeekSource,
  weeklyWindow,
  type WeekSource,
  type WeekSpace,
} from "@frejsi/shared/insights/week-input";
export interface WeeklyDeps {
  source: WeekSource;
  repo: InsightRepository;
  emit: EmitFn;
  now: () => Date;
  log: Logger;
  provider: (space: WeekSpace) => AiProvider | Promise<AiProvider>;
}
export async function runWeeklyInsights(deps: WeeklyDeps): Promise<void> {
  const now = deps.now();
  for (const space of await deps.source.spaces()) {
    try {
      const start = weeklyWindow(now, space.timezone);
      if (!start || (await deps.repo.find(space.id, "week", start))) continue;
      const input = await buildWeekInsightInput(space, start, deps.source, now);
      const provider = await deps.provider(space);
      const result = await narrateWeek(provider, input);
      await createInsight(deps.repo, deps.emit, {
        spaceId: space.id,
        kind: "week",
        subjectKey: start,
        statsHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
        text: result.summary,
        questions: result.questions,
        rejectedCount: result.rejectedCount,
        provider: space.aiProvider,
        model: result.model,
      });
      deps.log.info("insight.created", { spaceId: space.id, count: result.rejectedCount });
    } catch (error) {
      deps.log.warn("insight.failed", {
        spaceId: space.id,
        code: error instanceof HttpError ? error.code : "ai-unavailable",
      });
    }
  }
}
function dailyCap(): number {
  const raw = process.env.AI_DAILY_CAP ?? "50";
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value))
    throw new HttpError(503, "ai-not-configured");
  return value;
}
app.timer("weekly-insight", {
  schedule: "0 5 * * * *",
  runOnStartup: false,
  handler: async () =>
    runWeeklyInsights({
      source: new PrismaWeekSource(),
      repo: new PrismaInsightRepository(),
      emit,
      now: () => new Date(),
      log,
      provider: (space) => {
        const inner = aiProviders(process.env)[space.aiProvider];
        if (!inner) throw new HttpError(503, "ai-not-configured");
        return new CappedAiProvider(inner, new PrismaAiCallRepository(prisma), {
          spaceId: space.id,
          timezone: space.timezone,
          dailyCap: dailyCap(),
        });
      },
    }),
});
