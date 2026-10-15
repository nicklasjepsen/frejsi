// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { EventEnvelope, type EmitFn, type GlucoseImportResult } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureImport } from "@/lib/import/server";
import type { ImportServiceDb } from "@/lib/import/service";
import { captureLog, FakeLiveDb, spaceContext } from "@/lib/live/test-support";
import { database } from "@/lib/meals/test-support";

import { POST } from "./route";

const T0 = new Date("2026-10-15T13:13:00.000Z");
const fixtures = path.resolve(import.meta.dirname, "../../../../../../../fixtures/clarity");
const fixture = (name: string) => readFileSync(path.join(fixtures, name), "utf8");
const MMOL = fixture("clarity-export-mmol.csv");

let fake: FakeLiveDb;
let meals: ReturnType<typeof database>;
let readings: { spaceId: string; ts: Date; mmol: number; trend: string; source: string }[];
let events: { type: string; payload: unknown }[];
let logs: ReturnType<typeof captureLog>;

beforeEach(() => {
  fake = new FakeLiveDb(() => T0);
  fake.addSpace("s1");
  fake.addMember("owner-1", "s1", "owner");
  fake.addMember("carer-1", "s1", "carer");
  fake.addMember("viewer-1", "s1", "viewer");
  fake.addSpace("s2");
  fake.addMember("other-1", "s2", "owner");
  meals = database();
  readings = [];
  events = [];
  let seq = 0;
  const emit: EmitFn = (spaceId, type, payload) => {
    seq += 1;
    events.push({ type, payload });
    return Promise.resolve(
      EventEnvelope.parse({ spaceId, seq, ts: T0.toISOString(), type, payload }),
    );
  };
  const db = {
    space: {
      findUnique: (args: { where: { id: string } }) =>
        Promise.resolve(fake.spaces.find((s) => s.id === args.where.id) ?? null),
      updateMany: (args: { where: { id: string }; data: { lastReadingAt: Date } }) => {
        const space = fake.spaces.find((s) => s.id === args.where.id);
        if (space) space.lastReadingAt = args.data.lastReadingAt;
        return Promise.resolve({ count: space ? 1 : 0 });
      },
    },
    reading: {
      findMany: (args: { where: { spaceId: string; ts: { gte: Date; lte: Date } } }) =>
        Promise.resolve(
          readings
            .filter(
              (r) =>
                r.spaceId === args.where.spaceId &&
                r.ts >= args.where.ts.gte &&
                r.ts <= args.where.ts.lte,
            )
            .map((r) => ({ ts: r.ts })),
        ),
      createMany: (args: { data: typeof readings }) => {
        readings.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      },
    },
    meal: {
      findMany: (args: {
        where: { spaceId: string; ts: { gte: Date; lte: Date }; note: { in: string[] } };
      }) =>
        Promise.resolve(
          [...meals.rows.values()]
            .filter(
              (m) =>
                m.spaceId === args.where.spaceId &&
                m.ts >= args.where.ts.gte &&
                m.ts <= args.where.ts.lte &&
                args.where.note.in.includes(m.note ?? ""),
            )
            .map((m) => ({ ts: m.ts, totalCarbs: m.totalCarbs })),
        ),
    },
  } as unknown as ImportServiceDb;
  configureImport({
    sessionDb: fake.db,
    db,
    emit,
    meals: {
      repo: meals.repo,
      write: (work) => work(meals.repo, emit),
      photos: null,
      now: () => T0,
    },
    now: () => T0,
  });
  logs = captureLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  configureImport({});
});

async function post(sessionId: string | null, body: unknown, spaceId = "s1") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sessionId) headers.cookie = `frejsi_session=${sessionId}`;
  const res = await POST(
    new Request(`https://frejsi.example/api/spaces/${spaceId}/import`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    spaceContext(spaceId),
  );
  const json = (await res.json()) as unknown;
  return { res, body: res.status === 200 ? (json as GlucoseImportResult) : null, json };
}

describe("POST /api/spaces/:id/import (#154)", () => {
  it("stores the readings with the import source, the carb entries as meals, and answers counts", async () => {
    const { res, body } = await post("sess-owner-1", { text: MMOL });
    expect(res.status).toBe(200);
    expect(body).toEqual({
      format: "clarity",
      readings: {
        added: 10,
        skipped: 0,
        from: "2026-10-14T05:00:12.000Z",
        to: "2026-10-14T05:45:12.000Z",
      },
      meals: { added: 2, skipped: 0 },
      otherRows: 13,
    });
    expect(readings).toHaveLength(10);
    expect(new Set(readings.map((r) => r.source))).toEqual(new Set(["import:clarity"]));
    expect(fake.spaces[0]?.lastReadingAt).toEqual(new Date("2026-10-14T05:45:12.000Z"));

    const rows = [...meals.rows.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      spaceId: "s1",
      byUserId: "owner-1",
      ts: new Date("2026-10-14T05:12:00.000Z"),
      totalCarbs: 35,
      note: "Fra Dexcom-appen",
      bolusTs: null,
    });
    expect(rows[0]?.items).toEqual([
      {
        name: "Kulhydrater fra Dexcom-appen",
        carbs: 35,
        foodId: null,
        grams: null,
        portionLabel: null,
        position: 0,
      },
    ]);
    expect(rows[1]).toMatchObject({ ts: new Date("2026-10-14T10:30:00.000Z"), totalCarbs: 50 });

    expect(events.map((e) => e.type)).toEqual([
      "readings.imported",
      "meal.created",
      "meal.created",
    ]);
    expect(events[0]?.payload).toEqual({
      count: 10,
      from: "2026-10-14T05:00:12.000Z",
      to: "2026-10-14T05:45:12.000Z",
    });
  });

  it("adds nothing the second time: readings and meals are recognised", async () => {
    await post("sess-owner-1", { text: MMOL });
    const { body } = await post("sess-owner-1", { text: MMOL });
    expect(body?.readings).toMatchObject({ added: 0, skipped: 10 });
    expect(body?.meals).toEqual({ added: 0, skipped: 2 });
    expect(readings).toHaveLength(10);
    expect(meals.rows.size).toBe(2);
    expect(events).toHaveLength(3);
  });

  it("leaves the carbs alone when asked for readings only", async () => {
    const { body } = await post("sess-owner-1", { text: MMOL, createMeals: false });
    expect(body?.meals).toEqual({ added: 0, skipped: 2 });
    expect(meals.rows.size).toBe(0);
    expect(readings).toHaveLength(10);
  });

  it("is owners only, in the API: 403 for a carer or viewer, 404 for a non-member, 403 without a session", async () => {
    expect((await post("sess-carer-1", { text: MMOL })).res.status).toBe(403);
    expect((await post("sess-viewer-1", { text: MMOL })).res.status).toBe(403);
    expect((await post("sess-other-1", { text: MMOL })).res.status).toBe(404);
    expect((await post(null, { text: MMOL })).res.status).toBe(403);
    expect(readings).toHaveLength(0);
    expect(meals.rows.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("refuses a file it does not know, one with nothing in it, and a bad body, by code", async () => {
    const other = await post("sess-owner-1", { text: "name,carbs\nrye bread,41\n" });
    expect(other.res.status).toBe(400);
    expect(other.json).toMatchObject({ error: { code: "import-unrecognised" } });
    const empty = await post("sess-owner-1", { text: MMOL.split("\n").slice(0, 9).join("\n") });
    expect(empty.res.status).toBe(400);
    expect(empty.json).toMatchObject({ error: { code: "import-empty" } });
    expect((await post("sess-owner-1", { text: "" })).res.status).toBe(400);
    expect((await post("sess-owner-1", { csv: MMOL })).res.status).toBe(400);
    expect((await post("sess-owner-1", "not json")).res.status).toBe(400);
    expect(readings).toHaveLength(0);
  });

  it("keeps no trace of the dosing rows or the patient rows: not in the rows, the events, the answer or the log", async () => {
    const { json } = await post("sess-owner-1", { text: MMOL });
    const everything = JSON.stringify({
      readings,
      meals: [...meals.rows.values()],
      events,
      spaces: fake.spaces,
      answer: json,
    }).toLowerCase();
    for (const word of ["insulin", "fast-acting", "long-acting", "4.5", "alma", "example1"]) {
      expect(everything, word).not.toContain(word);
    }
    const log = logs.all();
    expect(log).toContain('"msg":"import.completed"');
    expect(log).toContain('"count":10');
    expect(log).not.toMatch(/EGV|Carbs|Alma|mmol/);
  });
});
