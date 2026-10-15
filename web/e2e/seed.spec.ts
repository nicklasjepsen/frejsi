// The seed (plan §8, task 10): every write it made has its event, so the space's `events` are a
// gap-free sequence and each stored reading has exactly one `reading` event; and it will not
// run with NODE_ENV=production.
import { spawnSync } from "node:child_process";
import path from "node:path";

import { prisma, type EventEnvelope } from "@frejsi/shared";
import { expect, test } from "./test";

import { SEED_PEOPLE } from "../scripts/seed";
import { WEB } from "./env";
import { seededSpace } from "./support";

test("the seeded space has a gap-free seq and one reading event per reading", async () => {
  const space = await seededSpace();
  expect(space.readings).toBeGreaterThan(200);

  const events = await prisma.event.findMany({
    where: { spaceId: space.spaceId },
    orderBy: { seq: "asc" },
    select: { seq: true, type: true, payload: true },
  });
  const { lastSeq } = await prisma.space.findUniqueOrThrow({
    where: { id: space.spaceId },
    select: { lastSeq: true },
  });
  expect(events.map((event) => event.seq)).toEqual(
    Array.from({ length: lastSeq }, (_, i) => i + 1),
  );

  const readings = await prisma.reading.findMany({
    where: { spaceId: space.spaceId },
    select: { ts: true },
  });
  const readingEvents = events
    .filter((event) => event.type === "reading")
    .map(
      (event) =>
        (JSON.parse(event.payload) as Extract<EventEnvelope, { type: "reading" }>["payload"]).ts,
    );
  expect(readingEvents.length).toBe(readings.length);
  expect(new Set(readingEvents)).toEqual(new Set(readings.map((row) => row.ts.toISOString())));

  // One member.joined per person, the source connected through the Settings route's function.
  const joined = events.filter((event) => event.type === "member.joined");
  expect(joined).toHaveLength(Object.keys(SEED_PEOPLE).length);
  expect(events.some((event) => event.type === "source.status")).toBe(true);
});

test("the seed refuses to run when NODE_ENV=production", async () => {
  const before = await prisma.event.count();
  const result = spawnSync(path.join(WEB, "node_modules/.bin/tsx"), ["scripts/seed.ts"], {
    cwd: WEB,
    env: { ...process.env, NODE_ENV: "production" },
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("NODE_ENV=production");
  expect(await prisma.space.count()).toBe(1);
  expect(await prisma.event.count()).toBe(before);
});
