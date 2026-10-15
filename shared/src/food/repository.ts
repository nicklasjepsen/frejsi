import { Prisma, type Food as FoodRow } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../db/client";
import { Food, FoodCandidate, Portion } from "../schemas/food";
import { foldForSearch } from "./search";
import { CacheFoodInput, type FoodRepository, type LibraryOptions } from "./types";

function fromRow(row: FoodRow): Food {
  return Food.parse({
    ...row,
    carbsPer100g: row.carbsPer100g?.toNumber() ?? undefined,
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

const libraryOrder: Prisma.FoodOrderByWithRelationInput[] = [
  { favourite: "desc" },
  { verified: "desc" },
  { name: "asc" },
  { id: "asc" },
];
const textWhere = (q: string): Prisma.FoodWhereInput => ({
  AND: foldForSearch(q)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ nameSearch: { contains: word } })),
});
const cacheWhere = (excluded: string[]): Prisma.FoodWhereInput => ({
  spaceId: null,
  sourceRef: { notIn: excluded },
});

export interface FoodDb {
  food: {
    findMany(args: Prisma.FoodFindManyArgs): Promise<FoodRow[]>;
    findFirst(args: Prisma.FoodFindFirstArgs): Promise<FoodRow | null>;
    create(args: Prisma.FoodCreateArgs): Promise<FoodRow>;
    update(args: Prisma.FoodUpdateArgs): Promise<FoodRow>;
  };
}

/** SQL Server adapter. Space-owned Food writes belong to the emitting web services. */
export class PrismaFoodRepository implements FoodRepository {
  constructor(private readonly db: FoodDb = prisma) {}

  async searchLibrary(spaceId: string, q: string, options: LibraryOptions = {}): Promise<Food[]> {
    return (
      await this.db.food.findMany({
        where: { ...textWhere(q), spaceId, ...(options.verifiedOnly ? { verified: true } : {}) },
        orderBy: libraryOrder,
        take: 20,
      })
    ).map(fromRow);
  }
  async findLibraryByBarcode(
    spaceId: string,
    barcode: string,
    options: LibraryOptions = {},
  ): Promise<Food[]> {
    return (
      await this.db.food.findMany({
        where: { spaceId, barcode, ...(options.verifiedOnly ? { verified: true } : {}) },
        orderBy: libraryOrder,
        take: 20,
      })
    ).map(fromRow);
  }
  async searchCache(q: string, excludeSourceRefs: string[] = []): Promise<Food[]> {
    return (
      await this.db.food.findMany({
        where: { ...textWhere(q), ...cacheWhere(excludeSourceRefs) },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 10,
      })
    ).map(fromRow);
  }
  async findCacheByBarcode(barcode: string, excludeSourceRefs: string[] = []): Promise<Food[]> {
    return (
      await this.db.food.findMany({
        where: { ...cacheWhere(excludeSourceRefs), barcode },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 10,
      })
    ).map(fromRow);
  }
  async upsertCache(input: CacheFoodInput): Promise<Food> {
    const { spaceId, verified, ...fields } = CacheFoodInput.parse(input);
    const candidate = FoodCandidate.parse(fields);
    const data = {
      ...candidate,
      spaceId,
      verified,
      nameSearch: foldForSearch(candidate.name),
      carbsPer100g: candidate.carbsPer100g ?? null,
      barcode: candidate.barcode ?? null,
      portions: JSON.stringify(candidate.portions),
    };
    const where = { spaceId: null, sourceRef: candidate.sourceRef };
    // Prisma cannot use a nullable field in a composite unique selector. SQL Server still enforces
    // the unique pair, including NULL, so recover a simultaneous insert through that constraint.
    const previous = await this.db.food.findFirst({ where });
    if (previous) return fromRow(await this.db.food.update({ where: { id: previous.id }, data }));
    try {
      return fromRow(await this.db.food.create({ data }));
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
        throw error;
      const winner = await this.db.food.findFirst({ where });
      if (!winner) throw error;
      return fromRow(await this.db.food.update({ where: { id: winner.id }, data }));
    }
  }
}
