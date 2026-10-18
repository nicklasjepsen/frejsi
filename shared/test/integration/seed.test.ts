import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";

const SEED = new URL("../../../web/scripts/seed.ts", import.meta.url).pathname;
let scratch: ScratchDatabase;
let db: PrismaClient;
interface Seeded {
  spaceId: string;
  readings: number;
  arnesRoom: { spaceId: string; readings: number; arneUserId: string };
}
let seeded: Seeded;
const NOW = new Date("2026-10-15T13:00:00Z");
beforeAll(async () => {
  vi.stubEnv("APP_ORIGIN", "http://localhost:3100");
  // The symptom window (10 min ahead, 7 days back) is checked against the wall clock; the e2e
  // fixes it with `e2e/clock.cjs`, this suite with a fake `Date` and real timers.
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  scratch = await createEmptyDatabase("frejsi_seed_it");
  migrate(scratch.url);
  db = new PrismaClient({ datasourceUrl: scratch.url });
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("seeds seventeen foods, fourteen reading days and seven meals through the emitting services", async () => {
  const { seed } = (await import(SEED)) as {
    seed: (options: { db: PrismaClient; now: () => Date }) => Promise<Seeded>;
  };
  seeded = await seed({ db, now: () => NOW });
  const { spaceId } = seeded;
  const foods = await db.food.findMany({ where: { spaceId } });
  expect(foods).toHaveLength(17);
  expect(await db.space.findUniqueOrThrow({ where: { id: spaceId } })).toMatchObject({
    aiEnabled: true,
    aiProvider: "anthropic",
  });
  const asked = foods.find((food) => food.origin === "ai");
  if (!asked?.createdBy) throw new Error("missing asked food creator");
  expect(asked).toMatchObject({ name: "Pasta med kødsovs", verified: false });
  expect((await db.user.findUniqueOrThrow({ where: { id: asked.createdBy } })).name).toBe("Alma");
  const insight = await db.insight.findFirstOrThrow({ where: { spaceId, kind: "meal" } });
  expect(insight.text).toBe("Toppen kom omkring en time efter måltidet.");
  expect(await db.event.count({ where: { spaceId, type: "insight.created" } })).toBe(1);
  const askedEvents = await db.event.findMany({ where: { spaceId, type: "estimate.asked" } });
  expect(askedEvents).toHaveLength(1);
  const askedEvent = askedEvents[0];
  if (!askedEvent) throw new Error("missing asked event");
  expect(JSON.parse(askedEvent.payload)).toMatchObject({
    foodId: asked.id,
    byUserId: asked.createdBy,
  });
  expect(
    foods
      .filter((food) => food.verified)
      .map((food) => food.name)
      .sort(),
  ).toEqual(
    [
      "Pasta bolognese",
      "Min madpakke",
      "Havregrød",
      "Rugbrød med ost",
      "Æble",
      "Banan",
      "Mælk",
    ].sort(),
  );
  expect(foods.find((food) => food.name === "Rugbrød")).toMatchObject({
    origin: "off",
    verified: false,
    barcode: "2000000000015",
  });
  expect(foods.find((food) => food.name === "Kartoffel kogt")).toMatchObject({
    origin: "frida",
    verified: false,
  });
  // Alma's simpleMode picker shows verified foods only: the artboard's seven. The breakfast dish
  // and the five lasagne ingredients are manual entries nobody has ticked.
  expect(foods.filter((food) => food.verified)).toHaveLength(7);
  expect(
    foods
      .filter((food) => !food.verified && food.origin === "family")
      .map((food) => food.name)
      .sort(),
  ).toEqual(
    [
      "Havregrød med æble",
      "Lasagneplader",
      "Hakket oksekød",
      "Løg",
      "Hakkede tomater",
      "Revet ost",
    ].sort(),
  );
  for (const food of foods) {
    expect(food.photoKey).toBeNull();
    expect(JSON.parse(food.portions) as unknown[]).not.toHaveLength(0);
    if (food.verified) expect(food.origin).toBe("family");
    const events = await db.event.findMany({
      where: { spaceId, type: { in: ["food.created", "food.verified"] } },
    });
    const forFood = events.filter(
      (event) => (JSON.parse(event.payload) as { foodId: string }).foodId === food.id,
    );
    expect(forFood.map((event) => event.type).sort()).toEqual(
      food.verified ? ["food.created", "food.verified"] : ["food.created"],
    );
  }
  const meals = await db.meal.findMany({
    where: { spaceId },
    orderBy: { ts: "asc" },
    include: { byUser: true, items: { orderBy: { position: "asc" } } },
  });
  const today = meals.slice(-3);
  expect(today.map((meal) => [meal.ts.toISOString(), meal.totalCarbs, meal.byUser.name])).toEqual([
    ["2026-10-15T05:15:00.000Z", 38, "Mette"],
    ["2026-10-15T07:50:00.000Z", 14, "Alma"],
    ["2026-10-15T10:10:00.000Z", 50, "Jonas"],
  ]);
  expect(today[2]?.bolusTs?.toISOString()).toBe("2026-10-15T09:58:00.000Z");
  expect(today.map((meal) => meal.items.map((item) => item.name))).toEqual([
    ["Havregrød med æble"],
    ["Æble"],
    ["Rugbrød med ost", "Æble"],
  ]);
  expect(JSON.parse(foods.find((food) => food.name === "Æble")?.portions ?? "[]")).toEqual(
    expect.arrayContaining([
      { label: "1 mellem", carbs: 14 },
      { label: "½ mellem", carbs: 7 },
    ]),
  );
  expect(
    meals.slice(0, 4).map((meal) => (+meal.ts - +(meal.bolusTs ?? new Date(0))) / 60_000),
  ).toEqual([15, 5, 0, 10]);
  expect(new Set(meals.slice(0, 4).map((meal) => meal.totalCarbs)).size).toBeGreaterThan(1);
  const readings = await db.reading.findMany({ where: { spaceId }, orderBy: { ts: "asc" } });
  expect(readings).toHaveLength(13 * 288 + 181);
  expect(
    new Set(
      readings.map((row) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(row.ts),
      ),
    ).size,
  ).toBe(14);
  expect(+(readings.at(-1)?.ts ?? new Date(0)) - +(readings[0]?.ts ?? new Date(0))).toBe(
    (readings.length - 1) * 300_000,
  );
  const events = await db.event.findMany({ where: { spaceId }, orderBy: { seq: "asc" } });
  expect(events.map((event) => event.seq)).toEqual(events.map((_, i) => i + 1));
  const readingEvents = events.filter((event) => event.type === "reading");
  expect(readingEvents).toHaveLength(readings.length);
  expect(
    new Set(readingEvents.map((event) => (JSON.parse(event.payload) as { ts: string }).ts)),
  ).toEqual(new Set(readings.map((reading) => reading.ts.toISOString())));
  const mealEvents = await db.event.findMany({ where: { spaceId, type: "meal.created" } });
  expect(mealEvents).toHaveLength(7);
  // The pump meal is the cycle's, announced in pump.meals and never as meal.created (plan §4).
  expect(
    new Set(mealEvents.map((event) => (JSON.parse(event.payload) as { mealId: string }).mealId)),
  ).toEqual(new Set(meals.filter((meal) => meal.source === null).map((meal) => meal.id)));
}, 300_000);

/** The people of the artboards (docs/design/README.md): fictional, reusable in seed data. */
const DESIGN_FIXTURE_NAMES = ["Alma", "Jonas", "Mette", "Birthe", "Søren", "Lærke"];
const local = (at: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Copenhagen",
    dateStyle: "short",
    timeStyle: "short",
  }).format(at);

it("connects the pump record and stores a day of boluses through the pump cycle, each write with its event", async () => {
  const { spaceId } = seeded;
  const jonas = await db.user.findFirstOrThrow({ where: { name: "Jonas" } });
  const space = await db.space.findUniqueOrThrow({ where: { id: spaceId } });
  // A fake reference: the secret it names does not exist, and nothing reads it.
  expect(JSON.parse(space.pumpSource ?? "null")).toEqual({
    type: "nightscout",
    secretRef: `pump-${spaceId}`,
    connectedBy: jonas.id,
  });
  expect(space.pumpStatus).toBe("connected");
  expect(space.pumpFailures).toBe(0);
  // Arnes rum has no pump.
  const arne = await db.space.findUniqueOrThrow({ where: { id: seeded.arnesRoom.spaceId } });
  expect(arne.pumpSource).toBeNull();

  const boluses = await db.pumpBolus.findMany({ where: { spaceId }, orderBy: { ts: "asc" } });
  expect(
    boluses.map((b) => [local(b.ts), b.kind, b.units.toNumber(), b.carbs, b.mealDismissed]),
  ).toEqual([
    ["2026-10-14 12:00", "standard", 2.2, 43, false],
    ["2026-10-14 18:30", "extended", 3, 45, false],
    ["2026-10-15 03:10", "automatic", 0.6, null, false],
    ["2026-10-15 05:40", "automatic", 0.3, null, false],
    ["2026-10-15 07:05", "standard", 1.8, 38, false],
    ["2026-10-15 09:45", "standard", 0.7, 14, false],
    ["2026-10-15 13:45", "automatic", 0.4, null, false],
  ]);
  expect(new Set(boluses.map((b) => b.sourceId)).size).toBe(7);
  expect(space.lastPumpAt?.toISOString()).toBe(boluses.at(-1)?.ts.toISOString());

  // The three standard boluses belong to seeded meals; the automatic ones never to a meal.
  const meals = await db.meal.findMany({
    where: { spaceId },
    orderBy: { ts: "asc" },
    include: { byUser: true, items: true },
  });
  const linked = meals.filter((meal) => meal.pumpBolusId !== null && meal.source === null);
  const byId = new Map(boluses.map((b) => [b.id, b]));
  expect(
    linked.map((meal) => [
      local(meal.ts),
      meal.byUser.name,
      byId.get(meal.pumpBolusId ?? "")?.kind,
      meal.bolusTs?.toISOString(),
    ]),
  ).toEqual([
    ["2026-10-14 12:10", "Jonas", "standard", boluses[0]?.ts.toISOString()],
    ["2026-10-15 07:15", "Mette", "standard", boluses[4]?.ts.toISOString()],
    ["2026-10-15 09:50", "Alma", "standard", boluses[5]?.ts.toISOString()],
  ]);
  // Today's lunch keeps the time tapped before v0.7.0 and no pump link.
  const lunch = meals.at(-1);
  expect(lunch?.pumpBolusId).toBeNull();
  expect(lunch?.bolusTs?.toISOString()).toBe("2026-10-15T09:58:00.000Z");

  // One untouched pump meal from the extended bolus nobody logged: unverified, no food, Jonas's.
  const pumpMeals = meals.filter((meal) => meal.source !== null);
  expect(pumpMeals).toHaveLength(1);
  const pumpMeal = pumpMeals[0];
  if (!pumpMeal) throw new Error("no pump meal");
  expect(pumpMeal).toMatchObject({
    source: "pump",
    pumpBolusId: boluses[1]?.id,
    totalCarbs: 45,
    note: null,
  });
  expect(pumpMeal.ts.toISOString()).toBe(boluses[1]?.ts.toISOString());
  expect(pumpMeal.bolusTs?.toISOString()).toBe(boluses[1]?.ts.toISOString());
  expect(pumpMeal.items).toHaveLength(1);
  expect(pumpMeal.items[0]).toMatchObject({
    name: "Kulhydrater fra pumpen",
    foodId: null,
    carbs: 45,
  });
  // Only the artboards' fictional people own anything the pump record made.
  for (const meal of [...linked, pumpMeal]) {
    expect(DESIGN_FIXTURE_NAMES).toContain(meal.byUser.name);
  }
  expect(pumpMeal.byUser.name).toBe("Jonas");

  // Every pump write has its event: the connection's pump.status, one pump.imported for the
  // cycle (on its last daily commit), and pump.meals for every link and the pump meal.
  const events = await db.event.findMany({
    where: { spaceId, type: { in: ["pump.status", "pump.imported", "pump.meals"] } },
    orderBy: { seq: "asc" },
  });
  const payloads = (type: string) =>
    events
      .filter((event) => event.type === type)
      .map((event) => JSON.parse(event.payload) as Record<string, unknown>);
  expect(payloads("pump.status")).toEqual([{ status: "connected", since: NOW.toISOString() }]);
  expect(payloads("pump.imported")).toEqual([
    {
      count: 7,
      from: boluses[0]?.ts.toISOString(),
      to: boluses.at(-1)?.ts.toISOString(),
    },
  ]);
  const changes = payloads("pump.meals") as {
    updated: string[];
    created: string[];
    removed: string[];
  }[];
  expect(new Set(changes.flatMap((change) => change.updated))).toEqual(
    new Set(linked.map((meal) => meal.id)),
  );
  expect(changes.flatMap((change) => change.created)).toEqual([pumpMeal.id]);
  expect(changes.flatMap((change) => change.removed)).toEqual([]);
  // The pump's events carry no units and no carbs.
  expect(events.map((event) => event.payload).join("\n")).not.toMatch(/units|carbs/);
});

it("seeds Arnes rum: a manual source, Mette as carer, three finger-pricks each with its event", async () => {
  const now = NOW;
  const alma = seeded;
  const room = alma.arnesRoom;
  expect(room.spaceId).not.toBe(alma.spaceId);
  // Alma's space is as it was: the sensor source, the same reading count.
  const almaSpace = await db.space.findUniqueOrThrow({ where: { id: alma.spaceId } });
  expect(JSON.parse(almaSpace.glucoseSource ?? "{}")).toMatchObject({ type: "dexcom-share" });
  expect(alma.readings).toBe(13 * 288 + 181);
  expect(await db.reading.count({ where: { spaceId: alma.spaceId } })).toBe(alma.readings);

  const space = await db.space.findUniqueOrThrow({
    where: { id: room.spaceId },
    include: { memberships: { include: { user: true } } },
  });
  expect(space.name).toBe("Arnes rum");
  expect(JSON.parse(space.glucoseSource ?? "{}")).toEqual({ type: "manual" });
  expect(space.memberships.map((m) => [m.user.name, m.role, m.user.simpleMode]).sort()).toEqual([
    ["Arne", "owner", false],
    ["Mette", "carer", false],
  ]);
  // Mette is the same person as in Almas rum, not a second user.
  expect(await db.user.count({ where: { name: "Mette" } })).toBe(1);

  const readings = await db.reading.findMany({
    where: { spaceId: room.spaceId },
    orderBy: { ts: "asc" },
  });
  expect(readings).toHaveLength(3);
  expect(room.readings).toBe(3);
  for (const reading of readings) {
    expect(reading.source).toBe("manual");
    expect(reading.trend).toBe("not-computable");
    expect(+now - +reading.ts).toBeGreaterThan(0);
    expect(+now - +reading.ts).toBeLessThan(24 * 3_600_000);
  }
  expect(space.lastReadingAt?.toISOString()).toBe(readings[2]?.ts.toISOString());

  const events = await db.event.findMany({
    where: { spaceId: room.spaceId },
    orderBy: { seq: "asc" },
  });
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  expect(space.lastSeq).toBe(events.length);
  const readingEvents = events.filter((e) => e.type === "reading");
  expect(readingEvents).toHaveLength(3);
  expect(new Set(readingEvents.map((e) => (JSON.parse(e.payload) as { ts: string }).ts))).toEqual(
    new Set(readings.map((r) => r.ts.toISOString())),
  );
  expect(events.filter((e) => e.type === "member.joined")).toHaveLength(2);

  // Arne can sign in: the seed prints an owner invitation for him, as for the other people.
  const { arneInvite } = (await import(SEED)) as {
    arneInvite: (space: Seeded, options: { db: PrismaClient }) => Promise<{ url: string }>;
  };
  const invite = await arneInvite(alma, { db });
  expect(invite.url).toContain("/invite/");
  const rows = await db.invite.findMany({ where: { spaceId: room.spaceId } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ role: "owner", name: "Arne", forUserId: room.arneUserId });
});

it("gives every seeded food a category and every meal the symbol derived from its items", async () => {
  const { spaceId } = seeded;
  const foods = await db.food.findMany({ where: { spaceId } });
  const CATEGORIES = [
    "bread",
    "fruit",
    "vegetables",
    "dairy",
    "starch",
    "protein",
    "sweets",
    "snack",
    "drink",
    "mixed",
  ];
  for (const food of foods) expect(CATEGORIES, food.name).toContain(food.category);
  expect(foods.find((food) => food.name === "Rugbrød")?.category).toBe("bread");
  expect(foods.find((food) => food.name === "Kartoffel kogt")?.category).toBe("starch");
  expect(foods.find((food) => food.name === "Pasta med kødsovs")?.category).toBe("mixed");
  const meals = await db.meal.findMany({ where: { spaceId }, orderBy: { ts: "asc" } });
  // The symbol is decided when the meal is saved: oats, an apple, and bread over the apple.
  expect(meals.slice(-3).map((meal) => meal.symbol)).toEqual(["starch", "fruit", "bread"]);
  expect(meals.slice(0, 4).map((meal) => meal.symbol)).toEqual([
    "bread",
    "bread",
    "bread",
    "bread",
  ]);
});

it("logs four symptoms across the two days before the seed clock, one by Alma in simpleMode, each with its event", async () => {
  const { spaceId } = seeded;
  const symptoms = await db.symptom.findMany({
    where: { spaceId },
    orderBy: { ts: "asc" },
    include: { byUser: true },
  });
  expect(
    symptoms.map((row) => [
      row.ts.toISOString(),
      row.kind,
      row.byUser.name,
      row.severity,
      row.note,
      row.resolvedTs?.toISOString() ?? null,
    ]),
  ).toEqual([
    [
      "2026-10-13T14:40:00.000Z",
      "headache",
      "Jonas",
      "light",
      "Efter skole",
      "2026-10-13T16:00:00.000Z",
    ],
    ["2026-10-13T18:05:00.000Z", "tired", "Mette", null, null, null],
    ["2026-10-14T09:20:00.000Z", "shaky", "Birthe", "medium", "Lige før frokost", null],
    ["2026-10-14T13:40:00.000Z", "stomach-ache", "Alma", null, null, null],
  ]);
  // The child's entry: kind and time only, as her picker sends it.
  expect(symptoms[3]?.byUser.simpleMode).toBe(true);
  // Two local days, and none on the seed clock's own day: the e2e logs today's first symptom itself.
  const days = new Set(
    symptoms.map((row) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(row.ts),
    ),
  );
  expect([...days].sort()).toEqual(["2026-10-13", "2026-10-14"]);
  const created = await db.event.findMany({ where: { spaceId, type: "symptom.created" } });
  expect(
    new Set(created.map((event) => (JSON.parse(event.payload) as { symptomId: string }).symptomId)),
  ).toEqual(new Set(symptoms.map((row) => row.id)));
  expect(
    created.map((event) => (JSON.parse(event.payload) as { kind: string }).kind).sort(),
  ).toEqual(["headache", "shaky", "stomach-ache", "tired"]);
  const updated = await db.event.findMany({ where: { spaceId, type: "symptom.updated" } });
  expect(
    updated.map((event) => (JSON.parse(event.payload) as { symptomId: string }).symptomId),
  ).toEqual([symptoms[0]?.id]);
});

it("saves Lasagne as a recipe dish of six portions whose lines resolve to seeded foods", async () => {
  const { spaceId } = seeded;
  const dish = await db.food.findFirstOrThrow({ where: { spaceId, name: "Lasagne" } });
  expect(dish).toMatchObject({ origin: "recipe", verified: false, category: "mixed" });
  expect(Number(dish.carbsPer100g)).toBeCloseTo(12.3, 1);
  const portions = JSON.parse(dish.portions) as { label: string; grams?: number; carbs: number }[];
  expect(portions.map((portion) => portion.label)).toEqual(["1 portion", "½ portion"]);
  expect(portions[0]).toMatchObject({ carbs: 38 });
  expect(portions[1]).toMatchObject({ carbs: 19 });
  expect(Math.round(portions[0]?.grams ?? 0)).toBe(308);
  const recipe = JSON.parse(dish.recipe ?? "null") as {
    ingredients: {
      name: string;
      foodId?: string;
      foodName?: string;
      carbs: number;
      noCarb?: boolean;
    }[];
    yieldPortions?: number;
    source: { kind: string; text?: string };
  };
  expect(recipe.yieldPortions).toBe(6);
  expect(recipe.source.kind).toBe("text");
  expect(recipe.source.text).toContain("lasagneplader");
  expect(recipe.ingredients).toHaveLength(8);
  expect(recipe.ingredients.reduce((sum, line) => sum + line.carbs, 0)).toBe(228);
  const foods = await db.food.findMany({ where: { spaceId }, select: { id: true, name: true } });
  const byId = new Map(foods.map((food) => [food.id, food.name]));
  for (const line of recipe.ingredients) {
    if (line.noCarb) {
      expect(line.foodId, line.name).toBeUndefined();
      expect(line.carbs).toBe(0);
    } else {
      expect(line.foodId, line.name).toBeDefined();
      expect(byId.get(line.foodId ?? ""), line.name).toBe(line.foodName);
    }
  }
  expect(recipe.ingredients.filter((line) => line.noCarb).map((line) => line.name)).toEqual([
    "olivenolie",
    "salt og peber",
  ]);
  const events = await db.event.findMany({ where: { spaceId, type: "food.created" } });
  expect(
    events.filter((event) => (JSON.parse(event.payload) as { foodId: string }).foodId === dish.id),
  ).toHaveLength(1);
});

it("is idempotent: a second run refuses the filled database and adds nothing", async () => {
  const { seed } = (await import(SEED)) as {
    seed: (options: { db: PrismaClient; now: () => Date }) => Promise<Seeded>;
  };
  const before = {
    spaces: await db.space.count(),
    foods: await db.food.count(),
    meals: await db.meal.count(),
    symptoms: await db.symptom.count(),
    boluses: await db.pumpBolus.count(),
    events: await db.event.count(),
  };
  await expect(seed({ db, now: () => NOW })).rejects.toThrow(/already has a space/);
  expect({
    spaces: await db.space.count(),
    foods: await db.food.count(),
    meals: await db.meal.count(),
    symptoms: await db.symptom.count(),
    boluses: await db.pumpBolus.count(),
    events: await db.event.count(),
  }).toEqual(before);
  expect(before.boluses).toBe(7);
});
