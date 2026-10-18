// @vitest-environment node
import { DayView } from "@frejsi/shared";
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureLog, FakeLiveDb, liveRequest, spaceContext } from "@/lib/live/test-support";

import { configureDay, type DayDb } from "./load-day";
import { GET } from "./route";

// 13:13 in Copenhagen (CEST, UTC+2) on Thursday 15 October 2026.
const T0 = new Date("2026-10-15T11:13:00.000Z");
const GLUCOSE_KEYS = new Set(["mmol", "mgdl", "trend", "reading", "readings", "glucose"]);
/** What a meal row holds but the day never sends, and the symptom fields the day never reads. */
const PRIVATE_KEYS = new Set(["note", "bolusTs", "severity", "resolvedTs", "kind", "recipe"]);

interface MealRow {
  id: string;
  spaceId: string;
  ts: Date;
  byUserId: string;
  totalCarbs: number;
  note: string | null;
  bolusTs: Date | null;
  photoKey: string | null;
  symbol: string | null;
  source?: string | null;
  pumpBolusId?: string | null;
  items: {
    name: string;
    portionLabel: string | null;
    grams: number | null;
    carbs: number;
    position: number;
  }[];
}

let fake: FakeLiveDb;
/** The test clock: the route and the session check read the same one. */
let clock: Date = T0;
let meals: MealRow[];
let photos: MemoryPhotoStore;
let logs: ReturnType<typeof captureLog>;
let mealQueries: unknown[];

/** The live fake for sessions and spaces, plus the meal reads the day route makes. */
function dayDb(): DayDb {
  const base = fake.db as unknown as Record<string, unknown>;
  const users = fake.users;
  return {
    ...base,
    meal: {
      findMany: (args: {
        where: {
          spaceId: string;
          ts: { gte: Date; lt: Date };
          OR?: { source: null | { not: string } }[];
        };
        orderBy: { ts: "desc" | "asc" };
        select: Record<string, unknown>;
      }) => {
        mealQueries.push(args);
        // SQL semantics: `source <> 'pump'` is not true for a NULL source, so null needs its own arm.
        const sourceOk = (source: string | null) =>
          !args.where.OR ||
          args.where.OR.some((arm) =>
            arm.source === null ? source === null : source !== null && source !== arm.source.not,
          );
        const rows = meals
          .filter(
            (m) =>
              m.spaceId === args.where.spaceId &&
              m.ts.getTime() >= args.where.ts.gte.getTime() &&
              m.ts.getTime() < args.where.ts.lt.getTime() &&
              sourceOk(m.source ?? null),
          )
          .sort((a, b) => b.ts.getTime() - a.ts.getTime())
          .map((m) => {
            const user = users.find((u) => u.id === m.byUserId);
            // Only what the query selected leaves the fake, as with Prisma.
            const full: Record<string, unknown> = {
              ...m,
              byUser: { id: m.byUserId, name: user?.name ?? "?" },
              items: [...m.items].sort((a, b) => a.position - b.position),
            };
            return Object.fromEntries(Object.keys(args.select).map((key) => [key, full[key]]));
          });
        return Promise.resolve(rows);
      },
    },
  } as unknown as DayDb;
}

function addMeal(
  row: Partial<Omit<MealRow, "ts">> & { id: string; ts: string; byUserId: string },
): void {
  const items = row.items ?? [
    { name: "Æble", portionLabel: "1 stk", grams: 150, carbs: 14, position: 0 },
  ];
  meals.push({
    spaceId: "s1",
    totalCarbs: items.reduce((sum, item) => sum + item.carbs, 0),
    note: null,
    bolusTs: null,
    photoKey: null,
    symbol: null,
    ...row,
    ts: new Date(row.ts),
    items,
  });
}

beforeEach(() => {
  clock = T0;
  fake = new FakeLiveDb(() => clock);
  fake.addSpace("s1", { timezone: "Europe/Copenhagen" });
  fake.addMember("owner-1", "s1", "owner");
  fake.addMember("carer-1", "s1", "carer");
  fake.addMember("viewer-1", "s1", "viewer");
  fake.addSpace("s2", { timezone: "America/New_York" });
  fake.addMember("other-1", "s2", "owner");
  for (const user of fake.users) {
    if (user.id === "owner-1") user.name = "Testforælder";
    if (user.id === "carer-1") user.name = "Testhjælper";
  }
  meals = [];
  mealQueries = [];
  photos = new MemoryPhotoStore();
  // Yesterday late evening local time (21:30 UTC on the 14th is 23:30 in Copenhagen): not today.
  addMeal({ id: "m0", ts: "2026-10-14T21:30:00.000Z", byUserId: "owner-1" });
  // 07:15, 09:50 and 12:10 local time.
  addMeal({
    id: "m1",
    ts: "2026-10-15T05:15:00.000Z",
    byUserId: "carer-1",
    items: [{ name: "Havregrød", portionLabel: null, grams: 250, carbs: 38, position: 0 }],
  });
  addMeal({ id: "m2", ts: "2026-10-15T07:50:00.000Z", byUserId: "carer-1" });
  addMeal({
    id: "m3",
    ts: "2026-10-15T10:10:00.000Z",
    byUserId: "owner-1",
    note: "Madpakke, BS 6,2 før",
    bolusTs: new Date("2026-10-15T09:58:00.000Z"),
    photoKey: "spaces/s1/meals/m3/abc123",
    symbol: "bread",
    items: [
      { name: "Æble", portionLabel: "1 stk", grams: 150, carbs: 14, position: 1 },
      { name: "Rugbrød med ost", portionLabel: "2 skiver", grams: null, carbs: 36, position: 0 },
    ],
  });
  // 22:30 UTC on the 15th is 00:30 on the 16th in Copenhagen: tomorrow.
  addMeal({ id: "m4", ts: "2026-10-15T22:30:00.000Z", byUserId: "owner-1" });
  configureDay({ db: dayDb(), photos, now: () => T0 });
  logs = captureLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  configureDay({});
});

const day = async (sessionId: string | null, date?: string, spaceId = "s1") => {
  const res = await GET(
    liveRequest(spaceId, "day", sessionId, date === undefined ? {} : { date }),
    spaceContext(spaceId),
  );
  const body = (await res.json()) as unknown;
  return { res, body: body as DayView };
};

/** Every key of a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
  }
  return [];
}

describe("GET /api/spaces/:id/day?date= (plan §7)", () => {
  it("returns today's meals in the space's timezone, newest first, with totals", async () => {
    const { res, body } = await day("sess-owner-1");
    expect(res.status).toBe(200);
    expect(DayView.safeParse(body).success).toBe(true);
    expect(body.date).toBe("2026-10-15");
    expect(body.timezone).toBe("Europe/Copenhagen");
    expect(body.meals.map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
    expect(body.totalCarbs).toBe(102);
    expect(body.mealCount).toBe(3);
    expect(body.lastMealAt).toBe("2026-10-15T10:10:00.000Z");
  });

  it("names each meal, its author, its items in order and its photo thumbnail", async () => {
    const { body } = await day("sess-owner-1");
    const [last, middle, first] = body.meals;
    expect(last).toMatchObject({
      ts: "2026-10-15T10:10:00.000Z",
      title: "Rugbrød med ost og Æble",
      slot: "lunch",
      totalCarbs: 50,
      symbol: "bread",
      byUser: { id: "owner-1", name: "Testforælder" },
      items: [
        { name: "Rugbrød med ost", portionLabel: "2 skiver", carbs: 36 },
        { name: "Æble", portionLabel: "1 stk", grams: 150, carbs: 14 },
      ],
      photo: {
        thumbUrl: "https://photos.example.invalid/spaces/s1/meals/m3/abc123/thumb.jpg",
        originalUrl: "https://photos.example.invalid/spaces/s1/meals/m3/abc123/original.jpg",
      },
    });
    expect(middle?.photo).toBeUndefined();
    // A row from before 0005 has no symbol: the apple, never a missing key.
    expect(middle?.symbol).toBe("unknown");
    expect(first).toMatchObject({ slot: "breakfast", byUser: { name: "Testhjælper" } });
  });

  it("carries no bolusTs and no note, not even as the title, and never reads them", async () => {
    const { body } = await day("sess-owner-1");
    const text = JSON.stringify(body);
    expect(keysOf(body)).not.toContain("bolusTs");
    expect(keysOf(body)).not.toContain("note");
    expect(text).not.toContain("Madpakke");
    expect(text).not.toContain("BS 6,2");
    const select = (mealQueries[0] as { select: Record<string, unknown> }).select;
    expect(Object.keys(select)).not.toContain("note");
    expect(Object.keys(select)).not.toContain("bolusTs");
  });

  it("gives a viewer the same day, symbols included, with not one glucose or private key at any depth", async () => {
    const { res, body } = await day("sess-viewer-1");
    expect(res.status).toBe(200);
    expect(body.mealCount).toBe(3);
    expect(body.meals.map((m) => m.symbol)).toEqual(["bread", "unknown", "unknown"]);
    const keys = keysOf(body);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect(GLUCOSE_KEYS.has(key), key).toBe(false);
    for (const key of keys) expect(PRIVATE_KEYS.has(key), key).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/mmol|mg\/dl|6,2/i);
    const select = (mealQueries[0] as { select: Record<string, unknown> }).select;
    expect(Object.keys(select)).toContain("symbol");
  });

  it("leaves untouched pump meals out of a viewer's day and a simpleMode day, in the query (v0.7.0)", async () => {
    addMeal({
      id: "pump-meal",
      ts: "2026-10-15T09:00:00.000Z",
      byUserId: "owner-1",
      source: "pump",
      pumpBolusId: "b1",
      bolusTs: new Date("2026-10-15T09:00:00.000Z"),
      items: [{ name: "Kulhydrater fra pumpen", portionLabel: null, grams: null, carbs: 45, position: 0 }],
    });
    addMeal({
      id: "linked",
      ts: "2026-10-15T08:30:00.000Z",
      byUserId: "owner-1",
      pumpBolusId: "b2",
      bolusTs: new Date("2026-10-15T08:25:00.000Z"),
    });
    fake.addMember("child-1", "s1", "carer");
    const child = fake.users.find((user) => user.id === "child-1");
    if (child) child.simpleMode = true;
    const pumpKeys = ["source", "pumpBolusId", "fromPump", "bolusUnits", "pumpCarbs", "bolusTs"];
    for (const session of ["sess-viewer-1", "sess-child-1"]) {
      mealQueries = [];
      const { res, body } = await day(session);
      expect(res.status).toBe(200);
      expect(body.meals.map((meal) => meal.id)).toEqual(["m3", "linked", "m2", "m1"]);
      expect(body.totalCarbs).toBe(14 + 38 + 50 + 14);
      expect(JSON.stringify(body)).not.toContain("pumpen");
      for (const key of keysOf(body)) expect(pumpKeys, key).not.toContain(key);
      const query = mealQueries[0] as { where: { OR?: unknown }; select: Record<string, unknown> };
      expect(query.where.OR).toEqual([{ source: null }, { source: { not: "pump" } }]);
      for (const key of pumpKeys) expect(Object.keys(query.select)).not.toContain(key);
    }
    // An owner or carer outside simpleMode has the pump meal in the day, still without a pump field.
    for (const session of ["sess-owner-1", "sess-carer-1"]) {
      const { body } = await day(session);
      expect(body.meals.map((meal) => meal.id)).toContain("pump-meal");
      for (const key of keysOf(body)) expect(pumpKeys, key).not.toContain(key);
    }
  });

  it("lets a carer read it too", async () => {
    expect((await day("sess-carer-1")).res.status).toBe(200);
  });

  it("reads another local day by date, and an empty day without lastMealAt", async () => {
    const yesterday = (await day("sess-owner-1", "2026-10-14")).body;
    expect(yesterday.meals.map((m) => m.id)).toEqual(["m0"]);
    const tomorrow = (await day("sess-owner-1", "2026-10-16")).body;
    expect(tomorrow.meals.map((m) => m.id)).toEqual(["m4"]);
    const empty = (await day("sess-owner-1", "2026-10-01")).body;
    expect(empty).toEqual({
      date: "2026-10-01",
      timezone: "Europe/Copenhagen",
      totalCarbs: 0,
      mealCount: 0,
      meals: [],
    });
  });

  it("takes today from the space's own timezone, not the server's", async () => {
    // 01:30 UTC on the 16th is still the 15th in New York.
    clock = new Date("2026-10-16T01:30:00.000Z");
    configureDay({ db: dayDb(), photos, now: () => clock });
    const { body } = await day("sess-other-1", undefined, "s2");
    expect(body.date).toBe("2026-10-15");
    expect(body.timezone).toBe("America/New_York");
  });

  it("leaves the photo out when no photo store is configured", async () => {
    configureDay({ db: dayDb(), photos: null, now: () => T0 });
    const { res, body } = await day("sess-owner-1");
    expect(res.status).toBe(200);
    expect(body.meals[0]?.photo).toBeUndefined();
  });

  it("answers 400 for an invalid date, 404 for a non-member and 403 without a session", async () => {
    for (const bad of ["", "15-10-2026", "2026-02-30", "2026-10-15T00:00", "today"]) {
      expect((await day("sess-owner-1", bad)).res.status, bad).toBe(400);
    }
    expect((await day("sess-other-1")).res.status).toBe(404);
    expect((await day(null)).res.status).toBe(403);
  });

  it("logs the space, the user and counts only: no names, titles, foods or carbs", async () => {
    await day("sess-viewer-1");
    const all = logs.all();
    expect(all).toContain('"spaceId":"s1"');
    expect(all).toContain('"userId":"viewer-1"');
    expect(all).toContain('"count":3');
    for (const pii of ["Testforælder", "Testhjælper", "Æble", "Rugbrød", "Havregrød", "Madpakke"]) {
      expect(all).not.toContain(pii);
    }
    expect(all).not.toContain("102");
  });
});
