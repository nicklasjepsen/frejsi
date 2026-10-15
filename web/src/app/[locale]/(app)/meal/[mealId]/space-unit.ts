import { GlucoseUnit, prisma, type PrismaClient } from "@frejsi/shared";

export type SpaceUnitDb = Pick<PrismaClient, "space">;

/**
 * The space's glucose unit, which the curve's labels and the tiles are drawn in. `MealCurveView`
 * is in mmol and carries no unit, and this screen opens the live feed without its readings window
 * (the only other carrier of the unit), so the page reads the one column itself. A read, no write.
 */
export async function loadSpaceUnit(
  spaceId: string,
  db: SpaceUnitDb = prisma,
): Promise<GlucoseUnit> {
  const row = await db.space.findUnique({ where: { id: spaceId }, select: { glucoseUnit: true } });
  const parsed = GlucoseUnit.safeParse(row?.glucoseUnit);
  return parsed.success ? parsed.data : "mmol";
}
