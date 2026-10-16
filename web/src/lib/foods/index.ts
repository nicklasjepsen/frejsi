import { mergeSemantic } from "@frejsi/shared/ai/search/rank";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AddCandidateRequest,
  CreateFoodRequest,
  Food,
  FoodView,
  Prisma,
  PrismaFoodRepository,
  HttpError,
  UpdateFoodRequest,
  VerifyFoodsRequest,
  carbsFor,
  foldForSearch,
  type FoodCandidate,
  type SessionContext,
} from "@frejsi/shared";
import { photoKey, processPhoto } from "@frejsi/shared/photos";
import { assertRole } from "@/lib/auth/session";
import {
  foodTransaction,
  resolveFoods,
  type FoodDeps,
  type FoodTx,
  type ResolvedFoods,
} from "./core";

import { confirmRemoteCandidate } from "./candidate";

export { configureFoods, type FoodDeps } from "./core";
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "validation");
  return result.data;
}
function authorize(spaceId: string, session: SessionContext, verify = false) {
  assertRole(session, spaceId, "owner", "carer");
  if (verify && session.simpleMode) throw new HttpError(400, "simple-mode");
}
type FoodRow = Awaited<ReturnType<FoodTx["food"]["findFirst"]>> & {};
function foodOf(row: FoodRow): Food {
  return Food.parse({
    ...row,
    carbsPer100g: row.carbsPer100g == null ? undefined : Number(row.carbsPer100g),
    portions: JSON.parse(row.portions) as unknown,
    barcode: row.barcode ?? undefined,
    photoKey: row.photoKey ?? undefined,
    verifiedBy: row.verifiedBy ?? undefined,
    verifiedAt: row.verifiedAt?.toISOString(),
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
interface Creator {
  id: string;
  name: string;
}
async function viewOf(
  row: FoodRow,
  deps: ResolvedFoods,
  creators?: ReadonlyMap<string, Creator>,
): Promise<FoodView> {
  const food = foodOf(row);
  const photo =
    food.photoKey && deps.photos
      ? {
          thumbUrl: await deps.photos.readUrl(food.photoKey, "thumb"),
          originalUrl: await deps.photos.readUrl(food.photoKey, "original"),
        }
      : undefined;
  const creator = food.createdBy
    ? creators
      ? (creators.get(food.createdBy) ?? null)
      : await deps.db.user.findUnique({
          where: { id: food.createdBy },
          select: { id: true, name: true },
        })
    : null;
  return FoodView.parse({
    id: food.id,
    name: food.name,
    carbsPer100g: food.carbsPer100g,
    portions: food.portions,
    barcode: food.barcode,
    origin: food.origin,
    verified: food.verified,
    verifiedBy: food.verifiedBy,
    favourite: food.favourite,
    updatedAt: food.updatedAt,
    createdAt: food.createdAt,
    sourceName: food.sourceName ?? undefined,
    createdBy: creator ?? undefined,
    photo,
  });
}
async function viewsOf(rows: FoodRow[], deps: ResolvedFoods): Promise<FoodView[]> {
  const ids = [...new Set(rows.flatMap((row) => (row.createdBy ? [row.createdBy] : [])))];
  const users = ids.length
    ? await deps.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const creators = new Map(users.map((user) => [user.id, user]));
  return Promise.all(rows.map((row) => viewOf(row, deps, creators)));
}
async function owned(
  db: FoodTx,
  spaceId: string,
  id: string,
  verifiedOnly = false,
): Promise<FoodRow> {
  const row = await db.food.findFirst({
    where: { id, spaceId, ...(verifiedOnly ? { verified: true } : {}) },
  });
  if (!row) throw new HttpError(404, "not-found");
  return row;
}
const listQuery = z.strictObject({
  mode: z.enum(["keyword", "semantic"]).default("keyword"),
  q: z.string().trim().max(80).default(""),
  filter: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,19}$/)
    .default("all"),
});
export async function listFoods(
  spaceId: string,
  session: SessionContext,
  query: { q?: string; filter?: string; mode?: string } = {},
  input: FoodDeps = {},
) {
  authorize(spaceId, session);
  const { q, filter, mode } = parse(listQuery, query);
  const deps = resolveFoods(input);
  const words = foldForSearch(q).split(/\s+/).filter(Boolean);
  const rows = await deps.db.food.findMany({
    where: {
      spaceId,
      ...(session.simpleMode ? { verified: true } : {}),
    },
    orderBy: [{ favourite: "desc" }, { verified: "desc" }, { name: "asc" }, { id: "asc" }],
  });
  const recent = await deps.db.mealItem.findMany({
    where: {
      food: { spaceId },
      meal: { spaceId, ts: { gte: new Date(deps.now().getTime() - 30 * 86_400_000) } },
    },
    select: { foodId: true },
    orderBy: { meal: { ts: "desc" } },
  });
  const recentIds = [...new Set(recent.map((item) => item.foodId))];
  const selected = (row: FoodRow, key: string) => {
    switch (key) {
      case "all":
        return true;
      case "unverified":
        return !row.verified;
      case "own":
        return row.origin === "family" || row.origin === "manual";
      case "favourites":
        return row.favourite;
      case "recent":
        return recentIds.includes(row.id);
      default:
        return row.origin === key;
    }
  };
  const keys = new Set([
    "all",
    "unverified",
    "own",
    "favourites",
    "recent",
    ...rows.map((row) => row.origin),
  ]);
  const counts = Object.fromEntries(
    [...keys].map((key) => [key, rows.filter((row) => selected(row, key)).length]),
  );
  // Counts describe the visible library, allowing the UI to distinguish no matches from no foods.
  let filtered = rows.filter(
    (row) => selected(row, filter) && words.every((word) => row.nameSearch.includes(word)),
  );
  if (mode === "semantic" && q.length >= 3) {
    const embed = await deps.searchEmbedding(spaceId, session);
    const embedding = await embed?.(q);
    if (embedding) {
      const hits = await deps.repo.searchLibrarySemantic(
        spaceId,
        embedding.vector,
        embedding.model,
        20,
        { verifiedOnly: session.simpleMode },
      );
      filtered = mergeSemantic(
        filtered,
        hits.flatMap(({ food, distance }) => {
          const row = rows.find((row) => row.id === food.id);
          return row && selected(row, filter) ? [{ food: row, distance }] : [];
        }),
      );
    }
  }
  if (filter === "recent")
    filtered.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
  return { foods: await viewsOf(filtered, deps), counts };
}
export async function getFood(
  spaceId: string,
  session: SessionContext,
  id: string,
  input: FoodDeps = {},
): Promise<FoodView> {
  authorize(spaceId, session);
  const deps = resolveFoods(input);
  return viewOf(await owned(deps.db, spaceId, id, session.simpleMode), deps);
}
const createRequest = CreateFoodRequest.safeExtend({
  from: z.enum(["library", "log"]).default("library"),
  verify: z.boolean().default(false),
});
export async function createFood(
  spaceId: string,
  session: SessionContext,
  value: unknown,
  input: FoodDeps = {},
): Promise<FoodView> {
  authorize(spaceId, session);
  const fields = parse(createRequest, value);
  authorize(spaceId, session, fields.verify);
  const deps = resolveFoods(input);
  const row = await foodTransaction(deps, async (tx, emit) => {
    const id = randomUUID();
    const origin = fields.from === "library" ? "family" : "manual";
    let food = await tx.food.create({
      data: {
        id,
        spaceId,
        name: fields.name,
        nameSearch: foldForSearch(fields.name),
        carbsPer100g: fields.carbsPer100g ?? null,
        portions: JSON.stringify(fields.portions),
        barcode: fields.barcode ?? null,
        favourite: fields.favourite ?? false,
        origin,
        sourceRef: `${origin}:${id}`,
        verified: false,
        createdBy: session.userId,
      },
    });
    await emit(spaceId, "food.created", { foodId: id, origin });
    if (fields.verify) {
      food = await tx.food.update({
        where: { id, spaceId },
        data: { verified: true, verifiedBy: session.userId, verifiedAt: deps.now() },
      });
      await emit(spaceId, "food.verified", { foodId: id, verifiedBy: session.userId });
    }
    return food;
  });
  return viewOf(row, deps);
}
export async function addCandidate(
  spaceId: string,
  session: SessionContext,
  value: FoodCandidate,
  input: FoodDeps = {},
): Promise<FoodView> {
  authorize(spaceId, session);
  let { candidate } = parse(AddCandidateRequest, { candidate: value });
  const deps = resolveFoods(input);
  if (!candidate.sourceRef.startsWith(`${candidate.origin}:`))
    throw new HttpError(400, "validation");
  const prior = await deps.db.food.findFirst({
    where: { spaceId, sourceRef: candidate.sourceRef },
  });
  if (prior) return viewOf(prior, deps);
  const source = deps.sources.find((source) => source.id === candidate.origin);
  const cached = await deps.db.food.findFirst({
    where: { spaceId: null, sourceRef: candidate.sourceRef, origin: candidate.origin },
  });
  if (cached) {
    // A cache row is already canonical, including when its plugin has since been disabled.
    // Never let a stale or crafted client copy replace the shared data.
    const food = foodOf(cached);
    candidate = parse(AddCandidateRequest, {
      candidate: {
        name: food.name,
        carbsPer100g: food.carbsPer100g,
        portions: food.portions,
        barcode: food.barcode,
        origin: food.origin,
        sourceRef: food.sourceRef,
      },
    }).candidate;
  } else {
    if (!source) throw new HttpError(400, "validation");
    // FoodSource has no lookup-by-reference or signed-result contract. A non-barcode pick
    // remains an unverified space copy; it cannot safely populate the cross-space cache.
    if (source.kind === "remote" && candidate.barcode) {
      candidate = await confirmRemoteCandidate(source, {
        ...candidate,
        barcode: candidate.barcode,
      });
      await new PrismaFoodRepository(deps.db).upsertCache({
        ...candidate,
        spaceId: null,
        verified: false,
      });
    }
  }
  const row = await foodTransaction(deps, async (tx, emit) => {
    const prior = await tx.food.findFirst({ where: { spaceId, sourceRef: candidate.sourceRef } });
    if (prior) return prior;
    const food = await tx.food.create({
      data: {
        ...candidate,
        sourceName: cached?.sourceName ?? null,
        spaceId,
        nameSearch: foldForSearch(candidate.name),
        carbsPer100g: candidate.carbsPer100g ?? null,
        portions: JSON.stringify(candidate.portions),
        barcode: candidate.barcode ?? null,
        verified: false,
        createdBy: session.userId,
      },
    });
    await emit(spaceId, "food.created", { foodId: food.id, origin: food.origin });
    return food;
  });
  return viewOf(row, deps);
}
export async function verifyFoods(
  spaceId: string,
  session: SessionContext,
  ids: string[],
  input: FoodDeps = {},
): Promise<FoodView[]> {
  authorize(spaceId, session, true);
  const { foodIds } = parse(VerifyFoodsRequest, { foodIds: ids });
  const deps = resolveFoods(input);
  const rows = await foodTransaction(deps, async (tx, emit) => {
    const foods = await Promise.all([...new Set(foodIds)].map((id) => owned(tx, spaceId, id)));
    const result: FoodRow[] = [];
    for (const food of foods) {
      result.push(
        await tx.food.update({
          where: { id: food.id, spaceId },
          data: { verified: true, verifiedBy: session.userId, verifiedAt: deps.now() },
        }),
      );
      await emit(spaceId, "food.verified", { foodId: food.id, verifiedBy: session.userId });
    }
    return result;
  });
  return viewsOf(rows, deps);
}
export async function updateFood(
  spaceId: string,
  session: SessionContext,
  id: string,
  value: unknown,
  input: FoodDeps = {},
): Promise<FoodView> {
  authorize(spaceId, session);
  const patch = parse(UpdateFoodRequest, value);
  if (Object.keys(patch).length === 0) throw new HttpError(400, "validation");
  const deps = resolveFoods(input);
  const row = await foodTransaction(deps, async (tx, emit) => {
    const current = foodOf(await owned(tx, spaceId, id));
    const fields = parse(CreateFoodRequest, {
      name: patch.name ?? current.name,
      carbsPer100g: patch.carbsPer100g !== undefined ? patch.carbsPer100g : current.carbsPer100g,
      portions: patch.portions ?? current.portions,
      barcode: patch.barcode ?? current.barcode,
      favourite: patch.favourite ?? current.favourite,
    });
    fields.portions = fields.portions.map((portion) =>
      portion.grams !== undefined && fields.carbsPer100g != null
        ? { ...portion, carbs: carbsFor(fields, portion.grams) }
        : portion,
    );
    parse(CreateFoodRequest, fields);
    const contentChanged =
      fields.name !== current.name ||
      (fields.carbsPer100g ?? null) !== (current.carbsPer100g ?? null) ||
      fields.barcode !== current.barcode ||
      JSON.stringify(fields.portions) !== JSON.stringify(current.portions);
    if (fields.name !== current.name) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE [Food] SET [embedding] = NULL, [embeddingModel] = NULL WHERE [id] = ${id} AND [spaceId] = ${spaceId}`,
      );
    }
    const food = await tx.food.update({
      where: { id, spaceId },
      data: {
        ...(fields.name !== current.name &&
        deps.sources.some((source) => source.kind === "remote" && source.id === current.origin)
          ? { sourceName: current.sourceName ?? current.name }
          : {}),
        ...(contentChanged ? { verified: false, verifiedBy: null, verifiedAt: null } : {}),
        name: fields.name,
        favourite: fields.favourite ?? false,
        barcode: fields.barcode ?? null,
        carbsPer100g: fields.carbsPer100g ?? null,
        portions: JSON.stringify(fields.portions),
        nameSearch: foldForSearch(fields.name),
      },
    });
    await emit(spaceId, "food.updated", { foodId: id });
    return food;
  });
  return viewOf(row, deps);
}
function requirePhotos(deps: ResolvedFoods) {
  if (!deps.photos) throw new HttpError(503, "photo-unavailable");
  return deps.photos;
}
async function photoAction<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "photo-type" || error.message === "photo-too-large")
    )
      throw new HttpError(400, error.message);
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "photo-unavailable");
  }
}
/** Blob deletion follows a committed change; cleanup must not turn that success into a 503. */
async function cleanupPhoto(deps: ResolvedFoods, key: string): Promise<void> {
  try {
    await requirePhotos(deps).delete(key);
  } catch {
    deps.log.warn("photo.cleanup-failed", { count: 1, code: "photo-unavailable" });
  }
}
export async function deleteFood(
  spaceId: string,
  session: SessionContext,
  id: string,
  input: FoodDeps = {},
): Promise<void> {
  authorize(spaceId, session);
  const deps = resolveFoods(input);
  const row = await foodTransaction(deps, async (tx, emit) => {
    const food = await owned(tx, spaceId, id);
    // The SetNull foreign key preserves the name/carbs snapshots on MealItem.
    await tx.food.delete({ where: { id, spaceId } });
    await emit(spaceId, "food.deleted", { foodId: id });
    return food;
  });
  const oldKey = row.photoKey;
  if (oldKey) await cleanupPhoto(deps, oldKey);
}
export async function setFoodPhoto(
  spaceId: string,
  session: SessionContext,
  id: string,
  bytes: Uint8Array | null,
  input: FoodDeps = {},
): Promise<FoodView> {
  authorize(spaceId, session);
  const deps = resolveFoods(input);
  const store = requirePhotos(deps);
  await owned(deps.db, spaceId, id);
  const key = bytes === null ? null : photoKey(spaceId, "foods", id);
  if (key && bytes) await photoAction(async () => store.put(key, await processPhoto(bytes)));
  let result: { food: FoodRow; oldKey: string | null };
  try {
    result = await foodTransaction(deps, async (tx, emit) => {
      const old = await owned(tx, spaceId, id);
      const food = await tx.food.update({ where: { id, spaceId }, data: { photoKey: key } });
      await emit(spaceId, "food.updated", { foodId: id });
      return { food, oldKey: old.photoKey };
    });
  } catch (error) {
    if (key) await cleanupPhoto(deps, key);
    throw error;
  }
  const oldKey = result.oldKey;
  if (oldKey) await cleanupPhoto(deps, oldKey);
  return viewOf(result.food, deps);
}
