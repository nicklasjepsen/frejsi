// `pnpm --filter ./web seed`: the fictional space of the artboards (plan §8, task 10) for local
// development and the release e2e. Every row goes through the code the routes and the poller
// use: the space and its first owner through the bootstrap, the others' memberships through
// `addMember`, the source through the Settings route's `saveConnectedSource`, and a day of
// readings through `runPollCycle` with `FakeGlucoseSource`. So every write has its event, and the
// `events` table is exactly what a real space with that history would hold.
//
// The people are the design's fixtures (docs/design/README.md: fictional, reusable in seed data).
// Refuses to run when NODE_ENV=production, and on a database that already has a space.
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  createEmit,
  glucoseSecretName,
  HttpError,
  prisma,
  runPollCycle,
  type PrismaClient,
  type Role,
} from "@frejsi/shared";
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

/** Every name the seed writes; the e2e checks that none of them reaches the server's log. */
export const SEED_NAMES: readonly string[] = [
  SEED_SPACE.name,
  ...Object.values(SEED_PEOPLE).map((person) => person.name),
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

  const [outcome] = await runPollCycle(
    {
      db,
      sources: () => new FakeGlucoseSource({ now }),
      emit: createEmit({ db, sink, now }),
      now,
    },
    { spaceId },
  );
  if (outcome?.outcome !== "ok") {
    throw new Error(`the poll cycle failed: ${outcome?.code ?? "no outcome"}`);
  }

  return { spaceId, people, ownerInviteUrl: boot.inviteUrl, readings: outcome.stored };
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
