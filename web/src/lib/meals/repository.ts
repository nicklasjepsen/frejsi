import {
  HttpError,
  prisma,
  storedSymbol,
  type Food,
  type FoodCategory,
  type MealItemView,
  type MealSymbol,
  type PrismaClient,
} from "@frejsi/shared";
import { Food as FoodSchema, Portion, Recipe } from "@frejsi/shared";
import { z } from "zod";

/** An item as saved: the food's category rides along for `mealSymbol()` and is not persisted. */
export interface MealSnapshot extends MealItemView {
  foodId?: string | undefined;
  category?: FoodCategory | undefined;
}
export interface MealData {
  id: string;
  spaceId: string;
  byUserId: string;
  ts: string;
  totalCarbs: number;
  symbol: MealSymbol;
  items: MealSnapshot[];
  note?: string | undefined;
  bolusTs?: string | undefined;
  photoKey?: string | undefined;
}
export interface MealRecord extends Omit<MealData, "symbol"> {
  byUser: { id: string; name: string };
  timezone: string;
  /** Always set by the Prisma repository (`unknown` for a row from before 0005). */
  symbol?: MealSymbol | undefined;
  /** `"pump"` while the meal is one the pump record made and nobody has ticked or edited. */
  source?: string | null | undefined;
  /** The bolus the pump record gave this meal (v0.7.0 plan §6). */
  pumpBolusId?: string | undefined;
  /** What the linked bolus recorded, read through the link: never copied onto the meal. */
  pumpBolus?: { units: number; carbs?: number | undefined } | undefined;
}
export interface MealChanges {
  ts?: string | undefined;
  totalCarbs?: number | undefined;
  symbol?: MealSymbol | undefined;
  items?: MealSnapshot[] | undefined;
  note?: string | undefined;
  bolusTs?: string | null | undefined;
  photoKey?: string | undefined;
  /** Null when a person adopts or edits a pump meal: from then on it is an ordinary meal. */
  source?: null | undefined;
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
  pumpBolus: { select: { units: true, carbs: true } },
};
type MealRow = NonNullable<Awaited<ReturnType<PrismaMealRepository["readRow"]>>>;
function record(row: MealRow): MealRecord {
  return {
    id: row.id,
    spaceId: row.spaceId,
    byUserId: row.byUserId,
    ts: row.ts.toISOString(),
    totalCarbs: row.totalCarbs,
    symbol: storedSymbol(row.symbol),
    note: row.note ?? undefined,
    bolusTs: row.bolusTs?.toISOString(),
    photoKey: row.photoKey ?? undefined,
    byUser: row.byUser,
    timezone: row.space.timezone,
    source: row.source ?? undefined,
    pumpBolusId: row.pumpBolusId ?? undefined,
    pumpBolus: row.pumpBolus
      ? { units: row.pumpBolus.units.toNumber(), carbs: row.pumpBolus.carbs ?? undefined }
      : undefined,
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
      category: row.category ?? undefined,
      recipe: row.recipe ? Recipe.parse(JSON.parse(row.recipe) as unknown) : undefined,
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
            ...(fields.symbol !== undefined ? { symbol: fields.symbol } : {}),
            ...(fields.note !== undefined ? { note: fields.note } : {}),
            ...("photoKey" in fields ? { photoKey: fields.photoKey ?? null } : {}),
            ...(fields.source === null ? { source: null } : {}),
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
