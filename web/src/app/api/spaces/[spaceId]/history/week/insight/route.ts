import { HttpError, prisma, weekRange } from "@frejsi/shared";
import { UpdateInsightRequest, type WeekInsightView } from "@frejsi/shared/schemas/ai";
import { readyAt } from "@frejsi/shared/insights/week-input";
import { updateInsightQuestions } from "@frejsi/shared/insights/store";
import { insightDeps } from "@/ai/insight/service";
import { route, json, parseBody } from "@/app/api/auth/http";
import { authorizeHistory, historyDate } from "@/lib/history/server";
async function handle(request: Request, spaceId: string, edit: boolean) {
  await authorizeHistory(request, spaceId);
  const start = historyDate(request, "start");
  if (!start) throw new HttpError(400, "validation");
  const space = await prisma.space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { aiEnabled: true, timezone: true },
  });
  if (weekRange(start, space.timezone).weekStart !== start) throw new HttpError(400, "validation");
  if (!space.aiEnabled)
    return json({
      state: "off",
      questionsEdited: false,
      rejectedCount: 0,
    } satisfies WeekInsightView);
  const deps = insightDeps();
  let row = await deps.repo.find(spaceId, "week", start);
  if (edit) {
    if (!row) throw new HttpError(404, "not-found");
    const body = await parseBody(request, UpdateInsightRequest);
    row = await updateInsightQuestions(deps.repo, deps.emit, row, body.questions);
  }
  return json(
    row
      ? ({
          state: "ready",
          summary: row.text,
          questions: row.questions,
          questionsEdited: row.questionsEdited,
          rejectedCount: row.rejectedCount,
          createdAt: row.createdAt.toISOString(),
        } satisfies WeekInsightView)
      : ({
          state: "pending",
          readyAt: readyAt(start, space.timezone).toISOString(),
          questionsEdited: false,
          rejectedCount: 0,
        } satisfies WeekInsightView),
  );
}
const contextHandler =
  (edit: boolean) => (request: Request, context: { params: Promise<{ spaceId: string }> }) =>
    route("spaces.week.insight", async (req) => handle(req, (await context.params).spaceId, edit))(
      request,
    );
export const GET = contextHandler(false);
export const PATCH = contextHandler(true);
