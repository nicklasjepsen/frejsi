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
  mealSymbol,
  mealTitle,
  type EmitFn,
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

import { rematch, type PumpLinks } from "./pump";
import { createMealWriter, type MealWriter } from "./transaction";

/** Who reads a meal: the language, and whether the pump record may be shown (plan §4). */
export type MealReader = Pick<SessionContext, "locale" | "simpleMode">;
const asReader = (who: Locale | MealReader): MealReader =>
  typeof who === "string" ? { locale: who, simpleMode: false } : who;

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
      let category;
      if (item.foodId) {
        const food = await repo.food(spaceId, item.foodId);
        if (!food) throw new HttpError(404, "not-found");
        if (session.simpleMode && !food.verified) throw new HttpError(400, "simple-mode");
        name = food.name;
        category = food.category;
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
      return {
        ...parsed.data,
        ...(item.foodId ? { foodId: item.foodId } : {}),
        ...(category ? { category } : {}),
      };
    }),
  );
}
/**
 * simpleMode shows nothing new (plan §4): a meal the pump record made and nobody has ticked does
 * not exist for a simpleMode session, enforced here for every read and write of the meal.
 */
function visible(row: MealRecord, reader: MealReader): MealRecord {
  if (reader.simpleMode && row.source === "pump") throw new HttpError(404, "not-found");
  return row;
}
async function load(
  spaceId: string,
  id: string,
  deps: MealDeps,
  reader: MealReader,
): Promise<MealRecord> {
  const row = await deps.repo.find(spaceId, id);
  if (!row) throw new HttpError(404, "not-found");
  return visible(row, reader);
}
/**
 * What the pump recorded for the meal, to owners and carers outside simpleMode only: the linked
 * bolus's units and calculator carbs, its id, and `fromPump` while the meal is an untouched pump
 * meal. A simpleMode session gets none of it, and no `bolusTs` the pump filled in either.
 */
function pumpFields(row: MealRecord, reader: MealReader) {
  if (reader.simpleMode) return row.bolusTs && !row.pumpBolusId ? { bolusTs: row.bolusTs } : {};
  return {
    ...(row.bolusTs ? { bolusTs: row.bolusTs } : {}),
    ...(row.pumpBolusId ? { pumpBolusId: row.pumpBolusId } : {}),
    ...(row.pumpBolusId && row.pumpBolus
      ? {
          bolusUnits: row.pumpBolus.units,
          ...(row.pumpBolus.carbs ? { pumpCarbs: row.pumpBolus.carbs } : {}),
        }
      : {}),
    ...(row.source === "pump" ? { fromPump: true as const } : {}),
  };
}
async function view(row: MealRecord, who: Locale | MealReader, deps: MealDeps): Promise<MealView> {
  const reader = asReader(who);
  const locale = reader.locale;
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
    symbol: row.symbol ?? "unknown",
    note: row.note,
    byUser: row.byUser,
    items,
    title: mealTitle(items, row.note, locale),
    slot: mealSlot(row.ts, row.timezone),
    photo,
    ...pumpFields(row, reader),
  });
}
/**
 * Matches the meals around `times` to the pump record again, in the write's transaction, and
 * emits `pump.meals` for every other meal that changed. Returns the person's own meal as it now
 * is (its link may have changed), or null when it is gone.
 */
async function matchPump(
  pump: PumpLinks | undefined,
  repo: MealRepository,
  emit: EmitFn,
  spaceId: string,
  times: string[],
  own: string,
): Promise<MealRecord | null> {
  if (!pump) return repo.find(spaceId, own);
  const changed = await rematch(pump, spaceId, times, own);
  if (changed) await emit(spaceId, "pump.meals", changed);
  return repo.find(spaceId, own);
}
function parsed<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, "validation");
  return result.data;
}
function checkTimestamp(
  session: SessionContext,
  input: { bolusTs?: string | null | undefined },
): void {
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
  try {
    await deps.photos.put(key, bytes);
  } catch {
    await cleanup(key, deps);
    throw new HttpError(503, "photo-unavailable");
  }
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
  who: Locale | MealReader,
  overrides: Partial<MealDeps> = {},
): Promise<MealView> {
  const deps = mealDeps(overrides);
  const reader = asReader(who);
  return view(await load(spaceId, id, deps, reader), reader, deps);
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
    row = await deps.write(async (repo, emit, pump) => {
      const created = await repo.create({
        id,
        spaceId,
        byUserId: session.userId,
        ts: data.ts ?? deps.now().toISOString(),
        note: data.note,
        bolusTs: data.bolusTs,
        photoKey: key,
        totalCarbs: items.reduce((sum, item) => sum + item.carbs, 0),
        // Decided once from the snapshots and stored: a later library edit never rewrites it.
        symbol: mealSymbol(items),
        items,
      });
      await emit(spaceId, "meal.created", {
        mealId: id,
        ts: created.ts,
        totalCarbs: created.totalCarbs,
      });
      return (await matchPump(pump, repo, emit, spaceId, [created.ts], id)) ?? created;
    });
  } catch (error) {
    await cleanup(key, deps);
    throw error;
  }
  return view(row, session, deps);
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
  const current = await load(spaceId, id, deps, session);
  const { items: requested, photoDataUrl, adopt, ...fields } = data;
  // "Det passer" on a meal that is not a pump meal changes nothing (plan §6).
  const adoptOnly =
    adopt === true && requested === undefined && !photoDataUrl && Object.keys(fields).length === 0;
  if (adoptOnly && current.source !== "pump") return view(current, session, deps);
  const changes: MealChanges = { ...fields };
  if (requested) {
    changes.items = await snapshots(spaceId, session, requested, deps.repo);
    changes.totalCarbs = changes.items.reduce((sum, item) => sum + item.carbs, 0);
    changes.symbol = mealSymbol(changes.items);
  }
  const key = photoDataUrl ? await upload(spaceId, id, photoDataUrl, deps) : undefined;
  if (key) changes.photoKey = key;
  let displacedKey: string | undefined;
  let row: MealRecord;
  try {
    row = await deps.write(async (repo, emit, pump) => {
      const previous = visible(await repo.lock(spaceId, id), session);
      displacedKey = previous.photoKey;
      const { bolusTs, ...rest } = changes;
      // A linked meal's bolus time is the one the pump recorded, read-only (plan §7): it can be
      // sent back unchanged with an edit, never set to another time or cleared.
      const pumpTime = previous.pumpBolusId !== undefined && bolusTs !== undefined;
      if (
        pumpTime &&
        (bolusTs === null || Date.parse(bolusTs) !== Date.parse(previous.bolusTs ?? ""))
      )
        throw new HttpError(400, "validation");
      // Adopting, or any edit by an owner or carer, makes a pump meal an ordinary meal.
      const saved = await repo.update(spaceId, id, {
        ...rest,
        ...(bolusTs !== undefined && !pumpTime ? { bolusTs } : {}),
        ...(previous.source === "pump" ? { source: null } : {}),
      });
      await emit(spaceId, "meal.updated", { mealId: id });
      if (Date.parse(saved.ts) === Date.parse(previous.ts)) return saved;
      return (await matchPump(pump, repo, emit, spaceId, [previous.ts, saved.ts], id)) ?? saved;
    });
  } catch (error) {
    await cleanup(key, deps);
    throw error;
  }
  if (key) await cleanup(displacedKey, deps);
  return view(row, session, deps);
}
/**
 * Deleting a meal frees its bolus for the meals around it. Deleting an untouched pump meal also
 * sets `mealDismissed` on its bolus, so the pump cycle never makes it again (plan §6).
 */
export async function deleteMeal(
  spaceId: string,
  id: string,
  session: MealReader,
  overrides: Partial<MealDeps> = {},
): Promise<void> {
  const deps = mealDeps(overrides);
  const displacedKey = await deps.write(async (repo, emit, pump) => {
    const previous = visible(await repo.lock(spaceId, id), session);
    if (previous.source === "pump" && previous.pumpBolusId)
      await pump?.dismiss(spaceId, previous.pumpBolusId);
    await repo.delete(spaceId, id);
    await emit(spaceId, "meal.deleted", { mealId: id });
    await matchPump(pump, repo, emit, spaceId, [previous.ts], id);
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
  await load(spaceId, id, deps, session);
  const key = dataUrl === null ? undefined : await upload(spaceId, id, dataUrl, deps);
  let displacedKey: string | undefined;
  let row: MealRecord;
  try {
    row = await deps.write(async (repo, emit) => {
      const previous = visible(await repo.lock(spaceId, id), session);
      displacedKey = previous.photoKey;
      const saved = await repo.update(spaceId, id, {
        photoKey: key,
        ...(previous.source === "pump" ? { source: null } : {}),
      });
      await emit(spaceId, "meal.updated", { mealId: id });
      return saved;
    });
  } catch (error) {
    await cleanup(key, deps);
    throw error;
  }
  await cleanup(displacedKey, deps);
  return view(row, session, deps);
}
