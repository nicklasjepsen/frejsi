// The read behind `GET /api/spaces/:id/pump` (v0.7.0 plan §4): the space's stored boluses in a
// range with the meal each belongs to, how far the record reaches, and the pump's status. It reads
// `PumpBolus` and the meal links only, never a reading, and passes `units` through from the stored
// Decimal unchanged: pump history, shown, never computed from. The caller has checked the role.
import {
  HttpError,
  prisma,
  PumpBolusKind,
  SourceStatus,
  type PrismaClient,
  type PumpBolusView,
  type PumpHistoryView,
} from "@frejsi/shared";

export type PumpReadDb = Pick<PrismaClient, "space" | "pumpBolus">;

/** Exactly the columns of `PumpBolusView`, and the first linked meal's id. */
const BOLUS_SELECT = {
  id: true,
  ts: true,
  units: true,
  kind: true,
  carbs: true,
  meals: { select: { id: true }, orderBy: { ts: "asc" }, take: 1 },
} as const;

export async function loadPumpHistory(
  spaceId: string,
  from: Date,
  to: Date,
  db: PumpReadDb = prisma,
): Promise<PumpHistoryView> {
  const [space, rows] = await Promise.all([
    db.space.findUnique({
      where: { id: spaceId },
      select: { pumpStatus: true, lastPumpAt: true },
    }),
    db.pumpBolus.findMany({
      where: { spaceId, ts: { gte: from, lte: to } },
      orderBy: { ts: "asc" },
      select: BOLUS_SELECT,
    }),
  ]);
  if (!space) throw new HttpError(404, "not-found");
  const status = SourceStatus.safeParse(space.pumpStatus);
  const boluses = rows.map((row): PumpBolusView => {
    const kind = PumpBolusKind.safeParse(row.kind);
    const mealId = row.meals[0]?.id;
    return {
      id: row.id,
      ts: row.ts.toISOString(),
      units: row.units.toNumber(),
      kind: kind.success ? kind.data : "other",
      ...(row.carbs !== null && row.carbs > 0 ? { carbs: row.carbs } : {}),
      ...(mealId !== undefined ? { mealId } : {}),
    };
  });
  return {
    boluses,
    ...(space.lastPumpAt ? { reach: space.lastPumpAt.toISOString() } : {}),
    status: status.success ? status.data : "not-configured",
  };
}
