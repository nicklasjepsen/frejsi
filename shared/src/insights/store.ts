import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import type { PrismaClient } from "../index";
import type { EmitFn } from "../events/emit";
import { assertNoDosing } from "../ai/guard";
import { MealInsight, WeekInsight, UpdateInsightRequest } from "../schemas/ai";
import type { InsightRepository, InsightRow, InsightWrite } from "./types";

export async function createInsight(
  repo: InsightRepository,
  emit: EmitFn,
  input: InsightWrite,
  eventSubjectKey = input.subjectKey,
) {
  if (input.kind === "meal") MealInsight.parse({ text: input.text });
  else WeekInsight.parse({ summary: input.text, questions: input.questions });
  [input.text, ...input.questions].forEach((text) => {
    assertNoDosing(text, "insight");
  });
  const row = await repo.save(input);
  await emit(input.spaceId, "insight.created", {
    insightId: row.id,
    kind: row.kind,
    subjectKey: eventSubjectKey,
  });
  return row;
}
export async function updateInsightQuestions(
  repo: InsightRepository,
  emit: EmitFn,
  row: InsightRow,
  questions: string[],
) {
  const parsed = UpdateInsightRequest.parse({ questions });
  parsed.questions.forEach((text) => {
    assertNoDosing(text, "question");
  });
  const updated = await repo.edit(row.spaceId, row.id, parsed.questions);
  await emit(row.spaceId, "insight.updated", { insightId: row.id });
  return updated;
}
function view(row: Awaited<ReturnType<PrismaClient["insight"]["findUniqueOrThrow"]>>): InsightRow {
  return {
    ...row,
    kind: row.kind as InsightRow["kind"],
    questions: row.questions
      ? UpdateInsightRequest.parse({ questions: JSON.parse(row.questions) as unknown }).questions
      : [],
    verified: false,
  };
}
/** The single production Insight writer; no schema change or second persistence path. */
export class PrismaInsightRepository implements InsightRepository {
  constructor(private readonly db: Pick<PrismaClient, "insight"> = prisma) {}
  async find(spaceId: string, kind: InsightRow["kind"], subjectKey: string) {
    const row = await this.db.insight.findUnique({
      where: { spaceId_kind_subjectKey: { spaceId, kind, subjectKey } },
    });
    return row ? view(row) : null;
  }
  async save(input: InsightWrite) {
    const data = { ...input, questions: JSON.stringify(input.questions), questionsEdited: false };
    const where = {
      spaceId_kind_subjectKey: {
        spaceId: input.spaceId,
        kind: input.kind,
        subjectKey: input.subjectKey,
      },
    };
    const update = { ...data, createdAt: new Date() };
    try {
      return view(await this.db.insight.upsert({ where, create: data, update }));
    } catch (error) {
      // SQL Server's Prisma upsert is a read then insert. A competing insert can win;
      // its unique row is now present, so finish the same write with an update.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
        throw error;
      return view(await this.db.insight.update({ where, data: update }));
    }
  }

  async edit(spaceId: string, id: string, questions: string[]) {
    return view(
      await this.db.insight.update({
        where: { id, spaceId },
        data: { questions: JSON.stringify(questions), questionsEdited: true },
      }),
    );
  }
}
