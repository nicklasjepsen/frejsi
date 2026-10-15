// `pnpm --filter ./web seed`: the fictional space of the artboards (plan §8, task 10) for local
// development and the release e2e. Every row goes through the code the routes and the poller
// use: the space and its first owner through the bootstrap, the others' memberships through
// `addMember`, the source through the Settings route's `saveConnectedSource`, and fourteen days of
// readings through `runPollCycle` with `FakeGlucoseSource`. So every write has its event, and the
// `events` table is exactly what a real space with that history would hold.
//
// The people are the design's fixtures (docs/design/README.md: fictional, reusable in seed data).
// Refuses to run when NODE_ENV=production, and on a database that already has a space.
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  createEmit,
  dayRange,
  type FoodView,
  type SessionContext,
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

import { saveConnectedSource } from "../src/app/api/spaces/[spaceId]/settings/space-settings";
import { bootstrapSpace } from "../src/lib/auth/bootstrap";
import { transact, type AuthDeps } from "../src/lib/auth/core";
import { createInvite, type CreatedInvite } from "../src/lib/auth/invites";
import { addMember } from "../src/lib/auth/members";

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

/** Hand-written artboard foods: fictional nutrition, restricted-circulation barcode, no photos. */
export const SEED_DISH = "Rugbrød med ost og et æble";
export const SEED_BARCODE = "2000000000015";
export const SEED_FOODS = [
  {
    name: "Rugbrød",
    origin: "off",
    sourceRef: `off:${SEED_BARCODE}`,
    barcode: SEED_BARCODE,
    carbsPer100g: 40,
    portions: [{ label: "1 skive", grams: 45, carbs: 18 }],
  },
  {
    name: "Kartoffel kogt",
    origin: "frida",
    sourceRef: "frida:fictional-seed",
    carbsPer100g: 17,
    portions: [{ label: "1 portion", grams: 100, carbs: 17 }],
  },
  { name: "Pasta bolognese", portions: [{ label: "1 portion", carbs: 55 }] },
  { name: "Min madpakke", portions: [{ label: "1 madpakke", carbs: 42 }] },
  { name: "Havregrød", portions: [{ label: "1 skål", carbs: 24 }] },
  {
    name: "Rugbrød med ost",
    portions: [
      { label: "1 skive", carbs: 18 },
      { label: "2 skiver", carbs: 36 },
    ],
  },
  {
    name: "Æble",
    portions: [
      { label: "1 stk", carbs: 14 },
      { label: "1 mellem", carbs: 14 },
      { label: "½ mellem", carbs: 7 },
    ],
  },
  { name: "Banan", portions: [{ label: "1 stk", carbs: 23 }] },
  { name: "Mælk", portions: [{ label: "1 glas", carbs: 10 }] },
] as const;

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
  ...Object.values(SEED_PEOPLE).map((person) => person.name),
  ...SEED_FOODS.map((food) => food.name),
  "Havregrød med æble",
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

export interface SeededSpace {
  spaceId: string;
  people: Record<SeedPersonKey, SeedPerson & { userId: string }>;
  /** The owner's own add-a-device link from the bootstrap. */
  ownerInviteUrl: string;
  /** Readings the poll cycle stored, each with its `reading` event. */
  readings: number;
}

export async function seed(options: SeedOptions = {}): Promise<SeededSpace> {
  assertNotProduction(options.env);
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
  // One cycle per local date, as specified. The fake's 24-hour cap can leave an
  // uncovered hour on an autumn 25-hour date; sequence continuity is about events.
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - daysAgo);
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
    const earlier = new Date(`${today}T12:00:00Z`);
    earlier.setUTCDate(earlier.getUTCDate() - (4 - index));
    const ts = seedTime(earlier, 12, 10);
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
      items: [{ name: "Havregrød med æble", carbs: 38 }],
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
  await createMeal(
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

  return { spaceId, people, ownerInviteUrl: boot.inviteUrl, readings };
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

async function main(): Promise<void> {
  assertNotProduction();
  // The links point at the local app unless told otherwise.
  process.env.APP_ORIGIN ??= "http://localhost:3000";
  const space = await seed();
  const lines = [
    `Seeded "${SEED_SPACE.name}" (${space.spaceId}) with ${String(space.readings)} readings.`,
    "Add-a-device links, one per person, each good once for seven days:",
  ];
  for (const key of Object.keys(SEED_PEOPLE) as SeedPersonKey[]) {
    const person = space.people[key];
    const url = key === "jonas" ? space.ownerInviteUrl : (await deviceInvite(space, key)).url;
    const mode = person.simpleMode ? ", simpleMode" : "";
    lines.push(`  ${person.name} (${person.role}${mode}): ${url}`);
  }
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
