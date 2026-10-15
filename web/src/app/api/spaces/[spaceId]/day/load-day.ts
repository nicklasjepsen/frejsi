// The viewer's day (plan §7, task 8): the one meal read every member, a viewer included, may make.
// It selects meal columns by name so `note`, `bolusTs` and anything of glucose never leave the
// database, and parses the result with the strict `DayView` before it is sent.
import {
  dayRange,
  DayView,
  HttpError,
  mealSlot,
  mealTitle,
  prisma,
  type Locale,
  type PrismaClient,
} from "@frejsi/shared";
import { createPhotoStoreFromEnv, type PhotoStore } from "@frejsi/shared/photos";
import { z } from "zod";

import type { SessionDb } from "@/lib/auth/session";

/** The Prisma delegates the day reads; tests pass a fake. The route writes nothing. */
export type DayDb = Pick<PrismaClient, "space" | "meal"> & SessionDb;

export interface DayDeps {
  db: DayDb;
  /** Null when no blob store is configured: meals are then sent without their photo. */
  photos: PhotoStore | null;
  now: () => Date;
}

let overrides: Partial<DayDeps> = {};
let envPhotos: PhotoStore | null | undefined;

/** Tests only: replace the database, the photo store or the clock. */
export function configureDay(deps: Partial<DayDeps>): void {
  overrides = deps;
}

export function dayDeps(): DayDeps {
  return {
    db: overrides.db ?? prisma,
    photos:
      overrides.photos !== undefined
        ? overrides.photos
        : envPhotos === undefined
          ? (envPhotos = createPhotoStoreFromEnv())
          : envPhotos,
    now: overrides.now ?? (() => new Date()),
  };
}

const DayParam = z.iso.date();

/** `?date=YYYY-MM-DD`, or null for today; anything else is a 400. */
export function dateParam(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("date");
  if (raw === null) return null;
  const parsed = DayParam.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "validation");
  return parsed.data;
}

/** The calendar date `at` falls on in `timezone`, as YYYY-MM-DD. */
export function localDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/**
 * The meals of the space's local `date` (today in `Space.timezone` when null), newest first, with
 * the day's totals. The title is built from the items only: a note is free text and may say
 * anything, so it stays on the meal's own route.
 */
export async function loadDay(
  spaceId: string,
  date: string | null,
  locale: Locale,
  deps: DayDeps,
): Promise<DayView> {
  const space = await deps.db.space.findUnique({
    where: { id: spaceId },
    select: { timezone: true },
  });
  if (!space) throw new HttpError(404, "not-found");
  const timezone = space.timezone;
  const day = date ?? localDate(deps.now(), timezone);
  const [start, end] = dayRange(day, timezone);

  const rows = await deps.db.meal.findMany({
    where: { spaceId, ts: { gte: start, lt: end } },
    orderBy: { ts: "desc" },
    select: {
      id: true,
      ts: true,
      totalCarbs: true,
      photoKey: true,
      byUser: { select: { id: true, name: true } },
      items: {
        orderBy: { position: "asc" },
        select: { name: true, portionLabel: true, grams: true, carbs: true },
      },
    },
  });

  const meals = await Promise.all(
    rows.map(async (row) => {
      const items = row.items.map((item) => ({
        name: item.name,
        ...(item.portionLabel !== null ? { portionLabel: item.portionLabel } : {}),
        ...(item.grams !== null ? { grams: Number(item.grams) } : {}),
        carbs: item.carbs,
      }));
      const photo =
        row.photoKey && deps.photos
          ? {
              thumbUrl: await deps.photos.readUrl(row.photoKey, "thumb"),
              originalUrl: await deps.photos.readUrl(row.photoKey, "original"),
            }
          : undefined;
      return {
        id: row.id,
        ts: row.ts.toISOString(),
        title: mealTitle(items, undefined, locale),
        slot: mealSlot(row.ts, timezone),
        totalCarbs: row.totalCarbs,
        byUser: { id: row.byUser.id, name: row.byUser.name },
        items,
        ...(photo ? { photo } : {}),
      };
    }),
  );

  const last = meals[0];
  return DayView.parse({
    date: day,
    timezone,
    totalCarbs: meals.reduce((sum, meal) => sum + meal.totalCarbs, 0),
    mealCount: meals.length,
    ...(last ? { lastMealAt: last.ts } : {}),
    meals,
  });
}
