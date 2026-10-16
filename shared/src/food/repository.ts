import { createEmit, type EmitFn, type EmitTx } from "../events/emit";
import { createEventSinkFromEnv } from "../events/pubsub";
import type { EventSink } from "../events/types";
import type { EventEnvelope } from "../schemas/events";
import { log } from "../log";
import { Prisma, type Food as FoodRow } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../db/client";
import { Food, FoodCandidate, Portion } from "../schemas/food";
import { foldForSearch } from "./search";
import {
  CacheFoodInput,
  type FoodRepository,
  type NormalisedName,
  type FoodEmbedding,
  type LibraryOptions,
} from "./types";

function fromRow(row: FoodRow & { creator?: { id: string; name: string } | null }): Food {
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

interface EnrichmentTx extends EmitTx {
  $executeRaw: typeof prisma.$executeRaw;
}
export interface FoodDb {
  $transaction?<T>(run: (tx: EnrichmentTx) => Promise<T>): Promise<T>;
  $queryRaw?: typeof prisma.$queryRaw;
  $executeRaw?: typeof prisma.$executeRaw;
  food: {
    findMany(
      args: Prisma.FoodFindManyArgs,
    ): Promise<(FoodRow & { creator?: { id: string; name: string } | null })[]>;
    findFirst(args: Prisma.FoodFindFirstArgs): Promise<FoodRow | null>;
    create(args: Prisma.FoodCreateArgs): Promise<FoodRow>;
    update(args: Prisma.FoodUpdateArgs): Promise<FoodRow>;
  };
}

/** SQL Server adapter; normalisation commits a space change and its event together. */
export class PrismaFoodRepository implements FoodRepository {
  constructor(
    private readonly db: FoodDb = prisma,
    private readonly sink: EventSink = createEventSinkFromEnv(),
  ) {}

  async normalisationCandidates(
    remoteOrigins: string[],
    spaceIds: string[],
    limit: number,
    includeCache = true,
  ): Promise<Food[]> {
    return (
      await this.db.food.findMany({
        where: {
          origin: { in: remoteOrigins, notIn: ["ai", "family", "manual"] },
          sourceName: null,
          verified: false,
          OR: [...(includeCache ? [{ spaceId: null }] : []), { spaceId: { in: spaceIds } }],
        },
        orderBy: [{ spaceId: "asc" }, { id: "asc" }],
        take: limit,
      })
    ).map(fromRow);
  }
  async setNormalisedName(
    row: Food,
    value: NormalisedName | null,
    spaceIds: string[],
    _emit: EmitFn,
  ): Promise<void> {
    if (!this.db.$executeRaw) throw new Error("Vector writes unavailable");
    const copies = await this.db.food.findMany({
      where: {
        origin: row.origin,
        sourceRef: row.sourceRef,
        name: row.name,
        sourceName: null,
        OR: [{ id: row.id }, { spaceId: { in: spaceIds } }],
      },
    });
    for (const copy of copies) {
      const portions = z.array(Portion).parse(JSON.parse(copy.portions) as unknown);
      const name = copy.verified ? copy.name : (value?.name ?? row.name);
      const sql = Prisma.sql`UPDATE [Food] SET [name] = ${name}, [nameSearch] = ${foldForSearch(name)}, [sourceName] = ${row.name},
        [portions] = ${JSON.stringify(portions.length || copy.verified ? portions : (value?.portions ?? []))}, [updatedAt] = ${new Date()}
        ${name !== row.name ? Prisma.sql`, [embedding] = NULL, [embeddingModel] = NULL` : Prisma.empty}
        WHERE [id] = ${copy.id} AND [name] = ${row.name} AND [portions] = ${copy.portions} AND [sourceName] IS NULL AND [verified] = ${copy.verified}`;
      if (copy.spaceId === null) {
        await this.db.$executeRaw(sql);
        continue;
      }
      if (!this.db.$transaction) throw new Error("Food event transactions unavailable");
      const spaceId = copy.spaceId;
      const queued: { group: string; envelope: EventEnvelope }[] = [];
      await this.db.$transaction(async (tx) => {
        const changed = await tx.$executeRaw(sql);
        if (!changed) return;
        const emit = createEmit({
          db: { $transaction: (run) => run(tx) },
          sink: {
            publish: (group, envelope) => {
              queued.push({ group, envelope });
              return Promise.resolve();
            },
          },
        });
        await emit(spaceId, "food.updated", { foodId: copy.id });
      });
      for (const event of queued) {
        try {
          await this.sink.publish(event.group, event.envelope);
        } catch {
          log.warn("event.publish-failed", { code: "publish-failed", count: 1 });
        }
      }
    }
  }
  async embeddingCandidates(
    spaceId: string | null,
    revision: string,
    limit: number,
  ): Promise<Food[]> {
    if (!this.db.$queryRaw) throw new Error("Vector queries unavailable");
    const ids = await this.db.$queryRaw<
      { id: string }[]
    >(Prisma.sql`SELECT TOP (${limit}) [id] FROM [Food]
      WHERE ${spaceId === null ? Prisma.sql`[spaceId] IS NULL` : Prisma.sql`[spaceId] = ${spaceId}`}
      AND ([embedding] IS NULL OR [embeddingModel] IS NULL OR [embeddingModel] NOT LIKE ${revision + "%"}) ORDER BY [id]`);
    if (!ids.length) return [];
    return (
      await this.db.food.findMany({
        where: { id: { in: ids.map((row) => row.id) } },
        orderBy: { id: "asc" },
      })
    ).map(fromRow);
  }
  async searchLibrarySemantic(
    spaceId: string,
    vector: number[],
    model: string,
    limit: number,
    options: LibraryOptions = {},
  ) {
    return this.semantic(
      vector,
      model,
      limit,
      Prisma.sql`[spaceId] = ${spaceId} ${options.verifiedOnly ? Prisma.sql`AND [verified] = 1` : Prisma.empty}`,
    );
  }
  async searchCacheSemantic(vector: number[], model: string, limit: number) {
    return this.semantic(vector, model, limit, Prisma.sql`[spaceId] IS NULL`);
  }
  private async semantic(vector: number[], model: string, limit: number, scope: Prisma.Sql) {
    if (!this.db.$queryRaw) throw new Error("Vector queries unavailable");
    const hits = await this.db.$queryRaw<{ id: string; distance: number }[]>(Prisma.sql`
      SELECT TOP (${limit}) [id], VECTOR_DISTANCE('cosine', [embedding], CAST(${JSON.stringify(vector)} AS vector(1024))) AS [distance]
      FROM [Food] WHERE ${scope} AND [embedding] IS NOT NULL AND [embeddingModel] = ${model}
      ORDER BY [distance], [id]`);
    if (!hits.length) return [];
    const rows = await this.db.food.findMany({
      where: { id: { in: hits.map((hit) => hit.id) } },
      include: { creator: { select: { id: true, name: true } } },
    });
    return hits.flatMap((hit) => {
      const row = rows.find((row) => row.id === hit.id);
      return row ? [{ food: fromRow(row), distance: hit.distance }] : [];
    });
  }
  async setEmbeddings(rows: FoodEmbedding[]): Promise<void> {
    if (!this.db.$executeRaw) throw new Error("Vector writes unavailable");
    for (const row of rows) {
      await this.db
        .$executeRaw(Prisma.sql`UPDATE [Food] SET [embedding] = CAST(${JSON.stringify(row.vector)} AS vector(1024)), [embeddingModel] = ${row.model}
        WHERE [id] = ${row.id} ${row.name === undefined ? Prisma.empty : Prisma.sql`AND [name] = ${row.name}`}`);
    }
  }
  async searchLibrary(spaceId: string, q: string, options: LibraryOptions = {}): Promise<Food[]> {
    return (
      await this.db.food.findMany({
        where: { ...textWhere(q), spaceId, ...(options.verifiedOnly ? { verified: true } : {}) },
        include: { creator: { select: { id: true, name: true } } },
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
        include: { creator: { select: { id: true, name: true } } },
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
