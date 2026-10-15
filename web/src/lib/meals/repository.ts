import { HttpError, prisma, type Food, type MealItemView, type PrismaClient } from "@frejsi/shared";
import { Food as FoodSchema, Portion } from "@frejsi/shared";
import { z } from "zod";

export interface MealSnapshot extends MealItemView {
  foodId?: string | undefined;
}
export interface MealData {
  id: string;
  spaceId: string;
  byUserId: string;
  ts: string;
  totalCarbs: number;
  items: MealSnapshot[];
  note?: string | undefined;
  bolusTs?: string | undefined;
  photoKey?: string | undefined;
}
export interface MealRecord extends MealData {
  byUser: { id: string; name: string };
  timezone: string;
}
export interface MealChanges {
  ts?: string | undefined;
  totalCarbs?: number | undefined;
  items?: MealSnapshot[] | undefined;
  note?: string | undefined;
  bolusTs?: string | null | undefined;
  photoKey?: string | undefined;
}
export interface MealRepository {
  food(spaceId: string, id: string): Promise<Food | null>;
  find(spaceId: string, id: string): Promise<MealRecord | null>;
  lock(spaceId: string, id: string): Promise<MealRecord>;
  create(data: MealData): Promise<MealRecord>;
  update(spaceId: string, id: string, data: MealChanges): Promise<MealRecord>;
  delete(spaceId: string, id: string): Promise<void>;
}
const include = {
  items: { orderBy: { position: "asc" as const } },
  byUser: { select: { id: true, name: true } },
  space: { select: { timezone: true } },
};
type MealRow = NonNullable<Awaited<ReturnType<PrismaMealRepository["readRow"]>>>;
function record(row: MealRow): MealRecord {
  return {
    id: row.id,
    spaceId: row.spaceId,
    byUserId: row.byUserId,
    ts: row.ts.toISOString(),
    totalCarbs: row.totalCarbs,
    note: row.note ?? undefined,
    bolusTs: row.bolusTs?.toISOString(),
    photoKey: row.photoKey ?? undefined,
    byUser: row.byUser,
    timezone: row.space.timezone,
    items: row.items.map((item) => ({
      name: item.name,
      foodId: item.foodId ?? undefined,
      grams: item.grams?.toNumber(),
      portionLabel: item.portionLabel ?? undefined,
      carbs: item.carbs,
    })),
  };
}
function itemRows(items: MealSnapshot[]) {
  return items.map((item, position) => ({
    name: item.name,
    carbs: item.carbs,
    foodId: item.foodId ?? null,
    grams: item.grams ?? null,
    portionLabel: item.portionLabel ?? null,
    position,
  }));
}

/** Nested item replacement is one atomic database write, always scoped to the requested space. */
export class PrismaMealRepository implements MealRepository {
  constructor(private readonly db: Pick<PrismaClient, "meal" | "food"> = prisma) {}
  async food(spaceId: string, id: string): Promise<Food | null> {
    const row = await this.db.food.findFirst({ where: { id, spaceId } });
    if (!row) return null;
    return FoodSchema.parse({
      ...row,
      carbsPer100g: row.carbsPer100g?.toNumber(),
      portions: z.array(Portion).parse(JSON.parse(row.portions) as unknown),
      barcode: row.barcode ?? undefined,
      photoKey: row.photoKey ?? undefined,
      verifiedBy: row.verifiedBy ?? undefined,
      verifiedAt: row.verifiedAt?.toISOString(),
      createdBy: row.createdBy ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  readRow(spaceId: string, id: string) {
    return this.db.meal.findFirst({ where: { spaceId, id }, include });
  }
  async find(spaceId: string, id: string): Promise<MealRecord | null> {
    const row = await this.readRow(spaceId, id);
    return row ? record(row) : null;
  }
  /** A no-op numeric update takes SQL Server's exclusive row lock until the outer commit. */
  async lock(spaceId: string, id: string): Promise<MealRecord> {
    try {
      return record(
        await this.db.meal.update({
          where: { id, spaceId },
          data: { totalCarbs: { increment: 0 } },
          include,
        }),
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2025")
        throw new HttpError(404, "not-found");
      throw error;
    }
  }
  async create(data: MealData): Promise<MealRecord> {
    const { items, ts, bolusTs, ...fields } = data;
    return record(
      await this.db.meal.create({
        data: {
          ...fields,
          note: fields.note ?? null,
          photoKey: fields.photoKey ?? null,
          ts: new Date(ts),
          bolusTs: bolusTs ? new Date(bolusTs) : null,
          items: { create: itemRows(items) },
        },
        include,
      }),
    );
  }
  async update(spaceId: string, id: string, data: MealChanges): Promise<MealRecord> {
    const { items, ts, bolusTs, ...fields } = data;
    try {
      return record(
        await this.db.meal.update({
          where: { id, spaceId },
          data: {
            ...(fields.totalCarbs !== undefined ? { totalCarbs: fields.totalCarbs } : {}),
            ...(fields.note !== undefined ? { note: fields.note } : {}),
            ...("photoKey" in fields ? { photoKey: fields.photoKey ?? null } : {}),
            ...(ts ? { ts: new Date(ts) } : {}),
            ...(bolusTs !== undefined
              ? { bolusTs: bolusTs === null ? null : new Date(bolusTs) }
              : {}),
            ...(items ? { items: { deleteMany: {}, create: itemRows(items) } } : {}),
          },
          include,
        }),
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2025")
        throw new HttpError(404, "not-found");
      throw error;
    }
  }
  async delete(spaceId: string, id: string): Promise<void> {
    const result = await this.db.meal.deleteMany({ where: { id, spaceId } });
    if (result.count === 0) throw new HttpError(404, "not-found");
  }
}
