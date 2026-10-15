import { prisma, Portion, type PrismaClient, type Reading } from "@frejsi/shared";
import { z } from "zod";
import type { HistoryMeal, HistoryRepository } from "./types";
const include = {
  items: {
    orderBy: { position: "asc" as const },
    include: { food: { select: { portions: true, carbsPer100g: true } } },
  },
  byUser: { select: { id: true, name: true } },
};
type Row = NonNullable<Awaited<ReturnType<PrismaHistoryRepository["readRow"]>>>;
function meal(row: Row): HistoryMeal {
  return {
    id: row.id,
    spaceId: row.spaceId,
    ts: row.ts.toISOString(),
    totalCarbs: row.totalCarbs,
    byUser: row.byUser,
    note: row.note ?? undefined,
    bolusTs: row.bolusTs?.toISOString(),
    photoKey: row.photoKey ?? undefined,
    items: row.items.map((item) => ({
      name: item.name,
      carbs: item.carbs,
      grams: item.grams?.toNumber(),
      portionLabel: item.portionLabel ?? undefined,
      foodId: item.foodId ?? undefined,
      food: item.food
        ? {
            portions: z.array(Portion).parse(JSON.parse(item.food.portions) as unknown),
            carbsPer100g: item.food.carbsPer100g?.toNumber(),
          }
        : undefined,
    })),
  };
}
/** Read-only queries, scoped by space; readings use the clustered (spaceId, ts) key. */
export class PrismaHistoryRepository implements HistoryRepository {
  constructor(private readonly db: Pick<PrismaClient, "space" | "meal" | "reading"> = prisma) {}
  async space(spaceId: string) {
    const row = await this.db.space.findUnique({
      where: { id: spaceId },
      select: { timezone: true, targetLow: true, targetHigh: true },
    });
    return row
      ? {
          timezone: row.timezone,
          target: { low: Number(row.targetLow), high: Number(row.targetHigh) },
        }
      : null;
  }
  async readingsBetween(spaceId: string, from: Date, to: Date): Promise<Reading[]> {
    const rows = await this.db.reading.findMany({
      where: { spaceId, ts: { gte: from, lte: to } },
      orderBy: { ts: "asc" },
      select: { ts: true, mmol: true, trend: true },
    });
    return rows.map((r) => ({
      ts: r.ts.toISOString(),
      mmol: Number(r.mmol),
      trend: r.trend as Reading["trend"],
    }));
  }
  async mealsBetween(spaceId: string, from: Date, to: Date) {
    return (
      await this.db.meal.findMany({
        where: { spaceId, ts: { gte: from, lt: to } },
        orderBy: [{ ts: "desc" }, { id: "desc" }],
        include,
      })
    ).map(meal);
  }
  readRow(spaceId: string, id: string) {
    return this.db.meal.findFirst({ where: { spaceId, id }, include });
  }
  async mealById(spaceId: string, id: string) {
    const row = await this.readRow(spaceId, id);
    return row ? meal(row) : null;
  }
  async candidateMeals(spaceId: string, before: string, foodIds: string[], limit: number) {
    return (
      await this.db.meal.findMany({
        where: {
          spaceId,
          ts: { lt: new Date(before) },
          items: { some: { foodId: { in: foodIds } } },
        },
        orderBy: [{ ts: "desc" }, { id: "desc" }],
        take: limit,
        include,
      })
    ).map(meal);
  }
  async recentMeals(spaceId: string, before: string, limit: number) {
    return (
      await this.db.meal.findMany({
        where: { spaceId, ts: { lt: new Date(before) } },
        orderBy: [{ ts: "desc" }, { id: "desc" }],
        take: limit,
        include,
      })
    ).map(meal);
  }
  async neighbours(spaceId: string, ts: string, mealId: string) {
    const [previous, next] = await Promise.all([
      this.db.meal.findFirst({
        where: {
          spaceId,
          OR: [{ ts: { lt: new Date(ts) } }, { ts: new Date(ts), id: { lt: mealId } }],
        },
        orderBy: [{ ts: "desc" }, { id: "desc" }],
        select: { id: true },
      }),
      this.db.meal.findFirst({
        where: {
          spaceId,
          OR: [{ ts: { gt: new Date(ts) } }, { ts: new Date(ts), id: { gt: mealId } }],
        },
        orderBy: [{ ts: "asc" }, { id: "asc" }],
        select: { id: true },
      }),
    ]);
    return {
      ...(previous ? { previousMealId: previous.id } : {}),
      ...(next ? { nextMealId: next.id } : {}),
    };
  }
  async hasAnythingBefore(spaceId: string, ts: Date) {
    const [meal, reading] = await Promise.all([
      this.db.meal.findFirst({ where: { spaceId, ts: { lt: ts } }, select: { id: true } }),
      this.db.reading.findFirst({ where: { spaceId, ts: { lt: ts } }, select: { ts: true } }),
    ]);
    return !!(meal ?? reading);
  }
}
