import { HttpError, prisma } from "@frejsi/shared";
import { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import { buildMealInput, localParts } from "@frejsi/shared/ai/insight/input";
import { route, json } from "@/app/api/auth/http";
import { insightDeps, mealInsight } from "@/ai/insight/service";
import { authorizeHistory } from "@/lib/history/server";
import { loadMealCurve } from "@/lib/history/meal-curve";
export function GET(
  request: Request,
  context: { params: Promise<{ spaceId: string; mealId: string }> },
) {
  return route("spaces.meals.insight", async (req) => {
    const { spaceId, mealId } = await context.params;
    const { session, deps } = await authorizeHistory(req, spaceId);
    const view = await loadMealCurve(spaceId, mealId, session.locale, deps);
    // An untouched pump meal is pump data: no model ever narrates it (v0.7.0 plan §5).
    if (view.meal.fromPump) throw new HttpError(409, "pump-meal");
    const space = await prisma.space.findUniqueOrThrow({
      where: { id: spaceId },
      select: { timezone: true, glucoseUnit: true, aiProvider: true },
    });
    const input = buildMealInput({
      locale: session.locale,
      glucoseUnit: GlucoseUnit.parse(space.glucoseUnit),
      meal: {
        title: view.meal.title,
        totalCarbs: view.meal.totalCarbs,
        slot: view.meal.slot,
        localTime: localParts(view.meal.ts, space.timezone).localTime,
      },
      stats: view.stats,
      previous: view.previous.map((p) => ({
        localDate: localParts(p.ts, space.timezone).localDate,
        totalCarbs: p.totalCarbs,
        stats: p.stats,
      })),
    });
    return json(
      await mealInsight(spaceId, mealId, session, input, {
        ...insightDeps(),
        ...(space.aiProvider ? { providerName: space.aiProvider } : {}),
      }),
    );
  })(request);
}
