// `pnpm --filter ./web seed`: the fictional space of the artboards (plan §8, task 10) for local
// development and the release e2e. Every row goes through the code the routes and the poller
// use: the space and its first owner through the bootstrap, the others' memberships through
// `addMember`, the source through the Settings route's `saveConnectedSource`, fourteen days of
// readings through `runPollCycle` with `FakeGlucoseSource`, the symptoms through the symptoms
// service and the recipe dish through `saveRecipe` (v0.6.0). So every write has its event, and
// the `events` table is exactly what a real space with that history would hold.
//
// The people are the design's fixtures (docs/design/README.md: fictional, reusable in seed data).
// Refuses to run when NODE_ENV=production, and on a database that already has a space, so a
// second run adds nothing.
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import {
  createEmit,
  dayRange,
  type FoodCategory,
  type FoodView,
  type RecipeIngredient,
  type SessionContext,
  type Severity,
  type SymptomKind,
  glucoseSecretName,
  HttpError,
  prisma,
  runPollCycle,
  type PrismaClient,
  type Role,
} from "@frejsi/shared";
import { FakeFoodSource } from "@frejsi/shared/food/fake";
import { createFood, addCandidate } from "../src/lib/foods";
import { createMeal } from "../src/lib/meals/service";
import { PrismaMealRepository } from "../src/lib/meals/repository";
import { createMealWriter } from "../src/lib/meals/transaction";
import { localDate } from "../src/app/api/spaces/[spaceId]/day/load-day";

import { MemoryEventSink } from "@frejsi/shared/events/memory";
import { FakeGlucoseSource } from "@frejsi/shared/glucose/fake";

import { createInsight, PrismaInsightRepository } from "@frejsi/shared/insights/store";
import { buildMealInput, localParts } from "@frejsi/shared/ai/insight/input";
import { loadMealCurve } from "../src/lib/history/meal-curve";
import { PrismaHistoryRepository } from "../src/lib/history/prisma";
import {
  saveConnectedSource,
  updateSpaceSettings,
} from "../src/app/api/spaces/[spaceId]/settings/space-settings";
import { bootstrapSpace } from "../src/lib/auth/bootstrap";
import { transact, type AuthDeps } from "../src/lib/auth/core";
import { createInvite, type CreatedInvite } from "../src/lib/auth/invites";
import { addMember } from "../src/lib/auth/members";
import { addManualReading } from "../src/lib/readings/service";
import { saveRecipe } from "../src/lib/recipes/service";
import { PrismaSymptomRepository } from "../src/lib/symptoms/repository";
import { createSymptom, updateSymptom } from "../src/lib/symptoms/service";
import { createSymptomWriter } from "../src/lib/symptoms/transaction";

export const SEED_SPACE = { name: "Almas rum", timezone: "Europe/Copenhagen" } as const;

export interface SeedPerson {
  name: string;
  role: Role;
  simpleMode: boolean;
}

/** Jonas and Mette own the space, Birthe and Alma help (Alma in simpleMode), Lærke looks on. */
export const SEED_PEOPLE = {
  jonas: { name: "Jonas", role: "owner", simpleMode: false },
  mette: { name: "Mette", role: "owner", simpleMode: false },
  birthe: { name: "Birthe", role: "carer", simpleMode: false },
  alma: { name: "Alma", role: "carer", simpleMode: true },
  laerke: { name: "Lærke", role: "viewer", simpleMode: false },
} as const satisfies Record<string, SeedPerson>;

export type SeedPersonKey = keyof typeof SEED_PEOPLE;

/**
 * The second space (v0.5.0): a grandfather without a sensor. His readings are finger-pricks typed
 * in by hand, so the source is `manual`. Mette is in both spaces, as the same person.
 */
export const SEED_ARNES_ROOM = { name: "Arnes rum", timezone: "Europe/Copenhagen" } as const;
export const SEED_ARNE = { name: "Arne", role: "owner", simpleMode: false } as const;
/** Minutes before "now" of the three finger-pricks, and their values in mmol/L. */
export const SEED_ARNES_READINGS = [
  { minutesAgo: 22 * 60, mmol: 6.8 },
  { minutesAgo: 9 * 60 + 30, mmol: 8.1 },
  { minutesAgo: 3 * 60 + 15, mmol: 5.9 },
] as const;

/**
 * Hand-written artboard foods: fictional nutrition, restricted-circulation barcode, no photos.
 * Every food carries a category (v0.6.0 plan §7), so each seeded meal gets a symbol.
 */
export const SEED_AI_FOOD = "Pasta med kødsovs";
export const SEED_INSIGHT = "Toppen kom omkring en time efter måltidet.";
export const SEED_TRANSCRIPT = "to skiver rugbrød med ost";
export const SEED_DISH = "Rugbrød med ost og et æble";
export const SEED_BREAKFAST = "Havregrød med æble";
export const SEED_BARCODE = "2000000000015";
export const SEED_FOODS = [
  {
    name: "Rugbrød",
    origin: "off",
    sourceRef: `off:${SEED_BARCODE}`,
    barcode: SEED_BARCODE,
    carbsPer100g: 40,
    category: "bread",
    portions: [{ label: "1 skive", grams: 45, carbs: 18 }],
  },
  {
    name: "Kartoffel kogt",
    origin: "frida",
    sourceRef: "frida:fictional-seed",
    carbsPer100g: 17,
    category: "starch",
    portions: [{ label: "1 portion", grams: 100, carbs: 17 }],
  },
  { name: "Pasta bolognese", category: "mixed", portions: [{ label: "1 portion", carbs: 55 }] },
  { name: "Min madpakke", category: "mixed", portions: [{ label: "1 madpakke", carbs: 42 }] },
  { name: "Havregrød", category: "starch", portions: [{ label: "1 skål", carbs: 24 }] },
  {
    name: "Rugbrød med ost",
    category: "bread",
    portions: [
      { label: "1 skive", carbs: 18 },
      { label: "2 skiver", carbs: 36 },
    ],
  },
  {
    name: "Æble",
    category: "fruit",
    portions: [
      { label: "1 stk", carbs: 14 },
      { label: "1 mellem", carbs: 14 },
      { label: "½ mellem", carbs: 7 },
    ],
  },
  { name: "Banan", category: "fruit", portions: [{ label: "1 stk", carbs: 23 }] },
  { name: "Mælk", category: "dairy", carbsPer100g: 5, portions: [{ label: "1 glas", carbs: 10 }] },
  { name: SEED_BREAKFAST, category: "starch", portions: [{ label: "1 skål", carbs: 38 }] },
] as const satisfies readonly { name: string; category: FoodCategory; [key: string]: unknown }[];

/** The family's own entries for the lasagne, verified like their other foods but not favourites. */
export const SEED_INGREDIENTS = [
  {
    name: "Lasagneplader",
    category: "starch",
    carbsPer100g: 72,
    portions: [{ label: "1 plade", grams: 20, carbs: 14 }],
  },
  {
    name: "Hakket oksekød",
    category: "protein",
    carbsPer100g: 0,
    portions: [{ label: "100 g", grams: 100, carbs: 0 }],
  },
  {
    name: "Løg",
    category: "vegetables",
    carbsPer100g: 7,
    portions: [{ label: "1 stk", grams: 100, carbs: 7 }],
  },
  {
    name: "Hakkede tomater",
    category: "vegetables",
    carbsPer100g: 4,
    portions: [{ label: "1 dåse", grams: 400, carbs: 16 }],
  },
  {
    name: "Revet ost",
    category: "dairy",
    carbsPer100g: 0,
    portions: [{ label: "1 håndfuld", grams: 30, carbs: 0 }],
  },
] as const satisfies readonly { name: string; category: FoodCategory; [key: string]: unknown }[];

/**
 * The recipe dish (v0.6.0 plan §6): the lines as Jonas reviewed them from pasted text, each
 * resolved to one of the family's foods, the two staples at 0 without a food, six portions.
 */
export const SEED_RECIPE_DISH = "Lasagne";
export const SEED_RECIPE_PORTIONS = 6;
export const SEED_RECIPE_TEXT = [
  "250 g lasagneplader",
  "500 g hakket oksekød",
  "1 løg",
  "400 g hakkede tomater",
  "5 dl mælk",
  "100 g revet ost",
  "2 spsk olivenolie",
  "salt og peber",
].join("\n");
interface SeedRecipeLine {
  name: string;
  amount?: number;
  unit?: string;
  grams?: number;
  /** The seeded food the line resolved to; absent for a no-carb staple. */
  food?: string;
  carbs: number;
}
export const SEED_RECIPE_LINES: readonly SeedRecipeLine[] = [
  { name: "lasagneplader", amount: 250, unit: "g", grams: 250, food: "Lasagneplader", carbs: 180 },
  { name: "hakket oksekød", amount: 500, unit: "g", grams: 500, food: "Hakket oksekød", carbs: 0 },
  { name: "løg", amount: 1, unit: "stk", grams: 100, food: "Løg", carbs: 7 },
  {
    name: "hakkede tomater",
    amount: 400,
    unit: "g",
    grams: 400,
    food: "Hakkede tomater",
    carbs: 16,
  },
  { name: "mælk", amount: 5, unit: "dl", grams: 500, food: "Mælk", carbs: 25 },
  { name: "revet ost", amount: 100, unit: "g", grams: 100, food: "Revet ost", carbs: 0 },
  { name: "olivenolie", amount: 2, unit: "spsk", carbs: 0 },
  { name: "salt og peber", carbs: 0 },
];

/**
 * How the family felt (v0.6.0 plan §5): four entries over the two days before the seed clock,
 * never on its own day, so the e2e's first symptom of today is the one it logs. Alma's is the
 * child's: her simpleMode picker sends the kind alone and the server stamps the time.
 */
export const SEED_SYMPTOMS = [
  {
    by: "jonas",
    daysAgo: 2,
    hour: 16,
    minute: 40,
    kind: "headache",
    severity: "light",
    note: "Efter skole",
    resolvedAt: { hour: 18, minute: 0 },
  },
  { by: "mette", daysAgo: 2, hour: 20, minute: 5, kind: "tired" },
  {
    by: "birthe",
    daysAgo: 1,
    hour: 11,
    minute: 20,
    kind: "shaky",
    severity: "medium",
    note: "Lige før frokost",
  },
  { by: "alma", daysAgo: 1, hour: 15, minute: 40, kind: "stomach-ache" },
] as const satisfies readonly {
  by: SeedPersonKey;
  daysAgo: number;
  hour: number;
  minute: number;
  kind: SymptomKind;
  severity?: Severity;
  note?: string;
  resolvedAt?: { hour: number; minute: number };
}[];

/** A wall-clock time on the seed's local day, including days when the UTC offset changes. */
export function seedTime(at: Date, hour: number, minute: number): string {
  const zone = SEED_SPACE.timezone;
  const [start] = dayRange(localDate(at, zone), zone);
  const guess = new Date(start.getTime() + (hour * 60 + minute) * 60_000);
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(guess);
  const actual =
    Number(parts.find((part) => part.type === "hour")?.value) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value);
  return new Date(guess.getTime() + (hour * 60 + minute - actual) * 60_000).toISOString();
}

/** Every name the seed writes; the e2e checks that none of them reaches the server's log. */
export const SEED_NAMES: readonly string[] = [
  SEED_SPACE.name,
  SEED_ARNES_ROOM.name,
  SEED_ARNE.name,
  SEED_AI_FOOD,
  SEED_INSIGHT,
  SEED_TRANSCRIPT,
  "Example pasta",
  "Example dish",
  "The peak followed the meal by about an hour.",
  ...Object.values(SEED_PEOPLE).map((person) => person.name),
  ...SEED_FOODS.map((food) => food.name),
  ...SEED_INGREDIENTS.map((food) => food.name),
  SEED_RECIPE_DISH,
  ...SEED_SYMPTOMS.flatMap((symptom) => ("note" in symptom ? [symptom.note] : [])),
  "et æble",
  SEED_DISH,
  SEED_BARCODE,
];

export class SeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefused";
  }
}

/** The seed writes fictional people into whatever `DATABASE_URL` names: never in production. */
export function assertNotProduction(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production") {
    throw new SeedRefused("the seed does not run with NODE_ENV=production");
  }
}

export interface SeedOptions {
  db?: PrismaClient;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

export interface SeededArnesRoom {
  spaceId: string;
  arneUserId: string;
  /** Finger-pricks stored, each with its `reading` event. */
  readings: number;
}

export interface SeededSpace {
  spaceId: string;
  /** The second, manual-source space. */
  arnesRoom: SeededArnesRoom;
  people: Record<SeedPersonKey, SeedPerson & { userId: string }>;
  /** The owner's own add-a-device link from the bootstrap. */
  ownerInviteUrl: string;
  /** Readings the poll cycle stored, each with its `reading` event. */
  readings: number;
}

export async function seed(options: SeedOptions = {}): Promise<SeededSpace> {
  assertNotProduction(options.env);
  // Local fictional data always uses the registry fake; no provider key is needed.
  process.env.FAKE_AI_PROVIDER = "1";
  const db = options.db ?? prisma;
  const now = options.now ?? (() => new Date());
  // Nothing listens to a seed: the events go to their table, the envelopes nowhere.
  const sink = new MemoryEventSink();
  const deps: AuthDeps = { db, sink, now };

  const token = randomBytes(32).toString("base64url");
  const jonas = SEED_PEOPLE.jonas;
  let boot;
  try {
    boot = await bootstrapSpace(
      {
        token,
        body: { spaceName: SEED_SPACE.name, ownerName: jonas.name, timezone: SEED_SPACE.timezone },
      },
      { ...deps, expectedToken: token },
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new SeedRefused("the database already has a space; the seed fills an empty one");
    }
    throw error;
  }
  const { spaceId } = boot;
  await updateSpaceSettings(spaceId, { aiEnabled: true, aiProvider: "anthropic" }, deps);
  const owner = await db.membership.findFirstOrThrow({
    where: { spaceId, role: "owner" },
    select: { userId: true },
  });

  const people = { jonas: { ...jonas, userId: owner.userId } } as SeededSpace["people"];
  for (const key of Object.keys(SEED_PEOPLE) as SeedPersonKey[]) {
    if (key === "jonas") continue;
    const person = SEED_PEOPLE[key];
    // As registration does: the user and the membership in one transaction, `member.joined` in it.
    const userId = await transact(db, sink, async (tx, emit) => {
      const user = await tx.user.create({
        data: { name: person.name, simpleMode: person.simpleMode },
      });
      await addMember({ spaceId, userId: user.id, role: person.role }, { db: tx, emit, now });
      return user.id;
    });
    people[key] = { ...person, userId };
  }

  await saveConnectedSource(
    spaceId,
    { type: "dexcom-share", region: "eu", secretRef: glucoseSecretName(spaceId) },
    deps,
  );

  let readings = 0;
  const at = now();
  const today = localDate(at, SEED_SPACE.timezone);
  /** Noon UTC on the local date `daysAgo` days before the seed clock's day. */
  const daysBefore = (daysAgo: number): Date => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    return date;
  };
  // One cycle per local date, as specified. The fake's 24-hour cap can leave an
  // uncovered hour on an autumn 25-hour date; sequence continuity is about events.
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const date = daysBefore(daysAgo);
    const [, end] = dayRange(date.toISOString().slice(0, 10), SEED_SPACE.timezone);
    const dayNow = () => new Date(Math.min(+end - 1, +at));
    const [outcome] = await runPollCycle(
      {
        db,
        sources: () => new FakeGlucoseSource({ now: dayNow }),
        emit: createEmit({ db, sink, now: dayNow }),
        now: dayNow,
      },
      { spaceId },
    );
    if (outcome?.outcome !== "ok") {
      throw new Error(`the poll cycle failed: ${outcome?.code ?? "no outcome"}`);
    }
    readings += outcome.stored;
  }

  const session = (key: SeedPersonKey): SessionContext => ({
    ...people[key],
    accent: "olive",
    theme: "system",
    locale: "da",
    memberships: [{ spaceId, role: people[key].role }],
  });
  const sources = SEED_FOODS.filter((food) => "origin" in food).map((food) => {
    if (!("origin" in food)) throw new Error("missing seed origin");
    return new FakeFoodSource({
      id: food.origin,
      kind: "local",
      candidates: [{ ...food, portions: [...food.portions] }],
    });
  });
  const foods = new Map<string, FoodView>();
  for (const food of SEED_FOODS) {
    const saved =
      "origin" in food
        ? await addCandidate(
            spaceId,
            session("jonas"),
            { ...food, portions: [...food.portions] },
            { db, sink, now, sources, photos: null },
          )
        : await createFood(
            spaceId,
            session("jonas"),
            { ...food, from: "library", favourite: true, verify: true },
            { db, sink, now, sources: [], photos: null },
          );
    foods.set(food.name, saved);
  }
  for (const food of SEED_INGREDIENTS) {
    const saved = await createFood(
      spaceId,
      session("jonas"),
      { ...food, portions: [...food.portions], from: "library", favourite: false, verify: true },
      { db, sink, now, sources: [], photos: null },
    );
    foods.set(food.name, saved);
  }
  const aiCandidate = {
    name: SEED_AI_FOOD,
    origin: "ai",
    sourceRef: "ai:fictional-seed",
    category: "mixed" as const,
    portions: [{ label: "1 tallerken", grams: 300, carbs: 55 }],
  };
  const askedFood = await addCandidate(spaceId, session("alma"), aiCandidate, {
    db,
    sink,
    now,
    sources: [new FakeFoodSource({ id: "ai", kind: "local", candidates: [aiCandidate] })],
    photos: null,
  });
  await createEmit({ db, sink, now })(spaceId, "estimate.asked", {
    foodId: askedFood.id,
    byUserId: people.alma.userId,
  });
  const foodId = (name: string): string => {
    const food = foods.get(name);
    if (!food) throw new Error("a seed food is missing");
    return food.id;
  };
  const mealDeps = {
    repo: new PrismaMealRepository(db),
    write: createMealWriter(db, sink, now),
    now,
    photos: null,
  };
  // Earlier occurrences vary portions and timing, using exactly the route's emitting writer.
  for (const [index, lead] of [15, 5, 0, 10].entries()) {
    const ts = seedTime(daysBefore(4 - index), 12, 10);
    await createMeal(
      spaceId,
      session("jonas"),
      {
        ts,
        note: SEED_DISH,
        bolusTs: new Date(Date.parse(ts) - lead * 60_000).toISOString(),
        items: [
          {
            foodId: foodId("Rugbrød med ost"),
            name: "Rugbrød med ost",
            portionLabel: index % 2 ? "2 skiver" : "1 skive",
          },
          {
            foodId: foodId("Æble"),
            name: "Æble",
            portionLabel: index % 2 ? "½ mellem" : "1 mellem",
          },
        ],
      },
      mealDeps,
    );
  }
  await createMeal(
    spaceId,
    session("mette"),
    {
      ts: seedTime(at, 7, 15),
      items: [{ foodId: foodId(SEED_BREAKFAST), name: SEED_BREAKFAST, portionLabel: "1 skål" }],
    },
    mealDeps,
  );
  await createMeal(
    spaceId,
    session("alma"),
    {
      ts: seedTime(at, 9, 50),
      items: [{ foodId: foodId("Æble"), name: "Æble", portionLabel: "1 stk", carbs: 14 }],
    },
    mealDeps,
  );
  const lunch = await createMeal(
    spaceId,
    session("jonas"),
    {
      ts: seedTime(at, 12, 10),
      bolusTs: seedTime(at, 11, 58),
      note: SEED_DISH,
      items: [
        {
          foodId: foodId("Rugbrød med ost"),
          name: "Rugbrød med ost",
          portionLabel: "2 skiver",
          carbs: 36,
        },
        { foodId: foodId("Æble"), name: "Æble", portionLabel: "1 mellem", carbs: 14 },
      ],
    },
    mealDeps,
  );

  const view = await loadMealCurve(spaceId, lunch.id, "da", {
    repo: new PrismaHistoryRepository(db),
    photos: null,
    now,
  });
  const input = buildMealInput({
    locale: "da",
    glucoseUnit: "mmol",
    meal: {
      title: view.meal.title,
      totalCarbs: view.meal.totalCarbs,
      slot: view.meal.slot,
      localTime: localParts(view.meal.ts, SEED_SPACE.timezone).localTime,
    },
    stats: view.stats,
    previous: view.previous.map((p) => ({
      localDate: localParts(p.ts, SEED_SPACE.timezone).localDate,
      totalCarbs: p.totalCarbs,
      stats: p.stats,
    })),
  });
  await db.$transaction((tx) =>
    createInsight(
      new PrismaInsightRepository(tx),
      createEmit({ db: { $transaction: (run) => run(tx) }, sink, now }),
      {
        spaceId,
        kind: "meal",
        subjectKey: `${lunch.id}:da`,
        statsHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
        text: SEED_INSIGHT,
        questions: [],
        rejectedCount: 0,
        provider: "anthropic",
        model: "fixture",
      },
      lunch.id,
    ),
  );
  await seedSymptoms({ db, sink, session, daysBefore });
  await saveRecipe(
    spaceId,
    session("jonas"),
    {
      title: SEED_RECIPE_DISH,
      ingredients: SEED_RECIPE_LINES.map(({ food, ...line }): RecipeIngredient => ({
        ...line,
        ...(food ? { foodId: foodId(food), foodName: food } : { noCarb: true }),
      })),
      yieldPortions: SEED_RECIPE_PORTIONS,
      source: { kind: "text", text: SEED_RECIPE_TEXT },
      category: "mixed",
    },
    { db, sink, now, sources: [], photos: null },
  );
  const arnesRoom = await seedArnesRoom({ db, sink, now }, people.mette.userId);
  return { spaceId, arnesRoom, people, ownerInviteUrl: boot.inviteUrl, readings };
}

/**
 * The symptoms through the service the routes call, so each write is one transaction with its
 * `symptom.created` and the kind is checked against the space. A carer's entry carries its time;
 * Alma's goes in as her picker sends it (the kind alone, a simpleMode session) with the service
 * clock set to that afternoon, as the server stamps a child's entry at the moment of the tap.
 */
async function seedSymptoms(deps: {
  db: PrismaClient;
  sink: MemoryEventSink;
  session: (key: SeedPersonKey) => SessionContext;
  daysBefore: (daysAgo: number) => Date;
}): Promise<void> {
  const { db, sink, session, daysBefore } = deps;
  const spaceId = session("jonas").memberships[0]?.spaceId;
  if (!spaceId) throw new Error("the seed session has no space");
  const repo = new PrismaSymptomRepository(db);
  for (const entry of SEED_SYMPTOMS) {
    const ts = seedTime(daysBefore(entry.daysAgo), entry.hour, entry.minute);
    const by = session(entry.by);
    const clock = () => new Date(ts);
    const symptomDeps = { repo, write: createSymptomWriter(db, sink, clock), now: clock };
    const saved = await createSymptom(
      spaceId,
      by,
      by.simpleMode
        ? { kind: entry.kind }
        : {
            kind: entry.kind,
            ts,
            ...("severity" in entry ? { severity: entry.severity } : {}),
            ...("note" in entry ? { note: entry.note } : {}),
          },
      symptomDeps,
    );
    if ("resolvedAt" in entry) {
      const resolvedTs = seedTime(
        daysBefore(entry.daysAgo),
        entry.resolvedAt.hour,
        entry.resolvedAt.minute,
      );
      await updateSymptom(
        spaceId,
        saved.id,
        by,
        { resolvedTs },
        {
          ...symptomDeps,
          write: createSymptomWriter(db, sink, () => new Date(resolvedTs)),
        },
      );
    }
  }
}

/**
 * "Arnes rum": the space, Arne as owner and Mette (already a person in Almas rum) as carer in one
 * transaction like the bootstrap; the manual source through the Settings route's writer; and the
 * three finger-pricks through `addManualReading`, the only writer of manual readings. Every row
 * has its event, so the space's `events` are gap-free like Almas.
 */
async function seedArnesRoom(
  deps: { db: PrismaClient; sink: MemoryEventSink; now: () => Date },
  metteId: string,
): Promise<SeededArnesRoom> {
  const { db, sink, now } = deps;
  const { spaceId, arneUserId } = await transact(db, sink, async (tx, emit) => {
    const space = await tx.space.create({
      data: { name: SEED_ARNES_ROOM.name, timezone: SEED_ARNES_ROOM.timezone },
    });
    const arne = await tx.user.create({
      data: { name: SEED_ARNE.name, simpleMode: SEED_ARNE.simpleMode },
    });
    const txDeps = { db: tx, emit, now };
    await addMember({ spaceId: space.id, userId: arne.id, role: SEED_ARNE.role }, txDeps);
    await addMember({ spaceId: space.id, userId: metteId, role: "carer" }, txDeps);
    return { spaceId: space.id, arneUserId: arne.id };
  });
  await saveConnectedSource(spaceId, { type: "manual" }, deps);
  for (const { minutesAgo, mmol } of SEED_ARNES_READINGS) {
    await addManualReading(
      spaceId,
      {
        value: mmol,
        unit: "mmol",
        ts: new Date(now().getTime() - minutesAgo * 60_000).toISOString(),
      },
      { db, sink, now, track: () => undefined },
    );
  }
  return { spaceId, arneUserId, readings: SEED_ARNES_READINGS.length };
}

/** A single-use add-a-device link for a seeded person, made by Jonas as People would. */
export function deviceInvite(
  space: SeededSpace,
  key: SeedPersonKey,
  options: Pick<SeedOptions, "db" | "now"> = {},
): Promise<CreatedInvite> {
  const person = space.people[key];
  return createInvite(
    {
      spaceId: space.spaceId,
      role: person.role,
      name: person.name,
      forUserId: person.userId,
      createdBy: space.people.jonas.userId,
    },
    {
      db: options.db ?? prisma,
      sink: new MemoryEventSink(),
      ...(options.now ? { now: options.now } : {}),
    },
  );
}

/** Arne's own add-a-device link, as the bootstrap makes the first owner's: he is the only owner. */
export function arneInvite(
  space: SeededSpace,
  options: Pick<SeedOptions, "db" | "now"> = {},
): Promise<CreatedInvite> {
  return createInvite(
    {
      spaceId: space.arnesRoom.spaceId,
      role: SEED_ARNE.role,
      name: SEED_ARNE.name,
      forUserId: space.arnesRoom.arneUserId,
      createdBy: space.arnesRoom.arneUserId,
    },
    {
      db: options.db ?? prisma,
      sink: new MemoryEventSink(),
      ...(options.now ? { now: options.now } : {}),
    },
  );
}

async function main(): Promise<void> {
  assertNotProduction();
  // The links point at the local app unless told otherwise.
  process.env.APP_ORIGIN ??= "http://localhost:3000";
  const space = await seed();
  const lines = [
    `Seeded "${SEED_SPACE.name}" (${space.spaceId}) with ${String(space.readings)} readings, ${String(SEED_SYMPTOMS.length)} symptoms and the recipe dish "${SEED_RECIPE_DISH}".`,
    `Seeded "${SEED_ARNES_ROOM.name}" (${space.arnesRoom.spaceId}) with ${String(space.arnesRoom.readings)} finger-prick readings; Mette is a carer there.`,
    "Add-a-device links, one per person, each good once for seven days:",
  ];
  for (const key of Object.keys(SEED_PEOPLE) as SeedPersonKey[]) {
    const person = space.people[key];
    const url = key === "jonas" ? space.ownerInviteUrl : (await deviceInvite(space, key)).url;
    const mode = person.simpleMode ? ", simpleMode" : "";
    lines.push(`  ${person.name} (${person.role}${mode}): ${url}`);
  }
  lines.push(
    `  ${SEED_ARNE.name} (${SEED_ARNE.role}, ${SEED_ARNES_ROOM.name}): ${(await arneInvite(space)).url}`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (path.basename(process.argv[1] ?? "") === "seed.ts") {
  main()
    .catch((error: unknown) => {
      const message = error instanceof SeedRefused ? error.message : String(error);
      process.stderr.write(`seed: ${message}\n`);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
