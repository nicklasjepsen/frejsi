import { randomUUID } from "node:crypto";
import {
  CreateMealRequest,
  UpdateMealRequest,
  MealItemView,
  MealView,
  HttpError,
  carbsFor,
  log,
  mealSlot,
  mealTitle,
  type Locale,
  type MealItemInput,
  type SessionContext,
} from "@frejsi/shared";
import {
  createPhotoStoreFromEnv,
  photoKey,
  processPhoto,
  type PhotoStore,
} from "@frejsi/shared/photos";
import {
  PrismaMealRepository,
  type MealChanges,
  type MealRecord,
  type MealRepository,
  type MealSnapshot,
} from "./repository";

import { createMealWriter, type MealWriter } from "./transaction";

export interface MealDeps {
  repo: MealRepository;
  photos: PhotoStore | null;
  write: MealWriter;
  now: () => Date;
}
export function mealDeps(overrides: Partial<MealDeps> = {}): MealDeps {
  return {
    repo: overrides.repo ?? new PrismaMealRepository(),
    photos:
      overrides.photos !== undefined ? overrides.photos : createPhotoStoreFromEnv(process.env),
    write: overrides.write ?? createMealWriter(undefined, undefined, overrides.now),
    now: overrides.now ?? (() => new Date()),
  };
}
async function snapshots(
  spaceId: string,
  session: SessionContext,
  items: MealItemInput[],
  repo: MealRepository,
): Promise<MealSnapshot[]> {
  return Promise.all(
    items.map(async (item) => {
      let { name, grams, carbs } = item;
      const { portionLabel } = item;
      if (item.foodId) {
        const food = await repo.food(spaceId, item.foodId);
        if (!food) throw new HttpError(404, "not-found");
        if (session.simpleMode && !food.verified) throw new HttpError(400, "simple-mode");
        name = food.name;
        if (portionLabel !== undefined) {
          const portion = food.portions.find((p) => p.label === portionLabel);
          if (!portion) throw new HttpError(400, "validation");
          carbs = carbsFor(food, portion);
          grams = portion.grams;
        } else if (grams !== undefined && food.carbsPer100g != null) {
          carbs = carbsFor(food, grams);
        }
      }
      const parsed = MealItemView.safeParse({ name, grams, portionLabel, carbs });
      if (!parsed.success) throw new HttpError(400, "validation");
      return { ...parsed.data, ...(item.foodId ? { foodId: item.foodId } : {}) };
    }),
  );
}
async function load(spaceId: string, id: string, deps: MealDeps): Promise<MealRecord> {
  const row = await deps.repo.find(spaceId, id);
  if (!row) throw new HttpError(404, "not-found");
  return row;
}
async function view(row: MealRecord, locale: Locale, deps: MealDeps): Promise<MealView> {
  const items = row.items.map(({ name, portionLabel, grams, carbs }) => ({
    name,
    portionLabel,
    grams,
    carbs,
  }));
  const photo =
    row.photoKey && deps.photos
      ? {
          thumbUrl: await deps.photos.readUrl(row.photoKey, "thumb"),
          originalUrl: await deps.photos.readUrl(row.photoKey, "original"),
        }
      : undefined;
  return MealView.parse({
    id: row.id,
    ts: row.ts,
    totalCarbs: row.totalCarbs,
    note: row.note,
    bolusTs: row.bolusTs,
    byUser: row.byUser,
    items,
    title: mealTitle(items, row.note, locale),
    slot: mealSlot(row.ts, row.timezone),
    photo,
  });
}
function parsed<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, "validation");
  return result.data;
}
function checkTimestamp(session: SessionContext, input: { bolusTs?: string | undefined }): void {
  if (session.simpleMode && input.bolusTs !== undefined) throw new HttpError(400, "simple-mode");
}
async function upload(
  spaceId: string,
  id: string,
  dataUrl: string,
  deps: MealDeps,
): Promise<string> {
  if (!deps.photos) throw new HttpError(503, "photo-unavailable");
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match?.[1]) throw new HttpError(400, "photo-type");
  if (match[1].length > Math.ceil((8 * 1024 * 1024) / 3) * 4)
    throw new HttpError(400, "photo-too-large");
  let bytes;
  try {
    bytes = await processPhoto(Buffer.from(match[1], "base64"));
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error && error.message === "photo-too-large"
        ? "photo-too-large"
        : "photo-type",
    );
  }
  const key = photoKey(spaceId, "meals", id);
  await deps.photos.put(key, bytes);
  return key;
}
async function cleanup(key: string | undefined, deps: MealDeps): Promise<void> {
  if (!key || !deps.photos) return;
  try {
    await deps.photos.delete(key);
  } catch {
    log.warn("meal.photo-delete-failed", { count: 1, code: "photo-unavailable" });
  }
}
export async function getMeal(
  spaceId: string,
  id: string,
  locale: Locale,
  overrides: Partial<MealDeps> = {},
): Promise<MealView> {
  const deps = mealDeps(overrides);
  return view(await load(spaceId, id, deps), locale, deps);
}
export async function createMeal(
  spaceId: string,
  session: SessionContext,
  input: CreateMealRequest,
  overrides: Partial<MealDeps> = {},
): Promise<MealView> {
  const deps = mealDeps(overrides);
  const data = parsed(CreateMealRequest, input);
  checkTimestamp(session, data);
  const items = await snapshots(spaceId, session, data.items, deps.repo);
  const id = randomUUID();
  const key = data.photoDataUrl ? await upload(spaceId, id, data.photoDataUrl, deps) : undefined;
  let row: MealRecord;
  try {
    row = await deps.write(async (repo, emit) => {
      const saved = await repo.create({
        id,
        spaceId,
        byUserId: session.userId,
        ts: data.ts ?? deps.now().toISOString(),
        note: data.note,
        bolusTs: data.bolusTs,
        photoKey: key,
        totalCarbs: items.reduce((sum, item) => sum + item.carbs, 0),
        items,
      });
      await emit(spaceId, "meal.created", {
        mealId: id,
        ts: saved.ts,
        totalCarbs: saved.totalCarbs,
      });
      return saved;
    });
  } catch (error) {
    await cleanup(key, deps);
    throw error;
  }
  return view(row, session.locale, deps);
}
export async function updateMeal(
  spaceId: string,
  id: string,
  session: SessionContext,
  input: UpdateMealRequest,
  overrides: Partial<MealDeps> = {},
): Promise<MealView> {
  const deps = mealDeps(overrides);
  const data = parsed(UpdateMealRequest, input);
  checkTimestamp(session, data);
  await load(spaceId, id, deps);
  const { items: requested, photoDataUrl, ...fields } = data;
  const changes: MealChanges = { ...fields };
  if (requested) {
    changes.items = await snapshots(spaceId, session, requested, deps.repo);
    changes.totalCarbs = changes.items.reduce((sum, item) => sum + item.carbs, 0);
  }
  const key = photoDataUrl ? await upload(spaceId, id, photoDataUrl, deps) : undefined;
  if (key) changes.photoKey = key;
  let displacedKey: string | undefined;
  let row: MealRecord;
  try {
    row = await deps.write(async (repo, emit) => {
      const previous = await repo.lock(spaceId, id);
      displacedKey = previous.photoKey;
      const saved = await repo.update(spaceId, id, changes);
      await emit(spaceId, "meal.updated", { mealId: id });
      return saved;
    });
  } catch (error) {
    await cleanup(key, deps);
    throw error;
  }
  if (key) await cleanup(displacedKey, deps);
  return view(row, session.locale, deps);
}
export async function deleteMeal(
  spaceId: string,
  id: string,
  overrides: Partial<MealDeps> = {},
): Promise<void> {
  const deps = mealDeps(overrides);
  const displacedKey = await deps.write(async (repo, emit) => {
    const previous = await repo.lock(spaceId, id);
    await repo.delete(spaceId, id);
    await emit(spaceId, "meal.deleted", { mealId: id });
    return previous.photoKey;
  });
  await cleanup(displacedKey, deps);
}
export async function setMealPhoto(
  spaceId: string,
  id: string,
  session: SessionContext,
  dataUrl: string | null,
  overrides: Partial<MealDeps> = {},
): Promise<MealView> {
  const deps = mealDeps(overrides);
  if (!deps.photos) throw new HttpError(503, "photo-unavailable");
  await load(spaceId, id, deps);
  const key = dataUrl === null ? undefined : await upload(spaceId, id, dataUrl, deps);
  let displacedKey: string | undefined;
  let row: MealRecord;
  try {
    row = await deps.write(async (repo, emit) => {
      const previous = await repo.lock(spaceId, id);
      displacedKey = previous.photoKey;
      const saved = await repo.update(spaceId, id, { photoKey: key });
      await emit(spaceId, "meal.updated", { mealId: id });
      return saved;
    });
  } catch (error) {
    await cleanup(key, deps);
    throw error;
  }
  await cleanup(displacedKey, deps);
  return view(row, session.locale, deps);
}
