// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayHistoryView, MealCurveView, WeekHistoryView } from "@frejsi/shared";
import { FakeLiveDb, captureLog, liveRequest, spaceContext } from "@/lib/live/test-support";
import { MemoryHistoryRepository } from "@/lib/history/memory";
import { configureHistory } from "@/lib/history/server";
import { GET as curve } from "../meals/[mealId]/curve/route";
import { GET as insight } from "../meals/[mealId]/insight/route";
import { GET as weekInsight } from "./week/insight/route";
import { GET as day } from "./day/route";
import { GET as week } from "./week/route";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test value");
  return value;
}
const now = new Date("2026-01-05T12:00:00Z");
let repo: MemoryHistoryRepository;
let fake: FakeLiveDb;
let logs: ReturnType<typeof captureLog>;
const handlers = [
  (session: string | null, query = {}) =>
    curve(liveRequest("s1", "meals/meal-private/curve", session, query), {
      params: Promise.resolve({ spaceId: "s1", mealId: "meal-private" }),
    }),
  (session: string | null, query = {}) =>
    day(liveRequest("s1", "history/day", session, query), spaceContext("s1")),
  (session: string | null, query = {}) =>
    week(liveRequest("s1", "history/week", session, query), spaceContext("s1")),
] as const;
beforeEach(() => {
  repo = new MemoryHistoryRepository();
  repo.spaces.set("s1", { timezone: "Europe/Copenhagen", target: { low: 4, high: 10 } });
  repo.meals.push({
    id: "meal-private",
    spaceId: "s1",
    ts: "2026-01-05T11:00:00.000Z",
    totalCarbs: 40,
    items: [{ name: "Private fictional dish", carbs: 40 }],
    note: "private-note",
    byUser: { id: "owner", name: "Fictional member" },
  });
  repo.readings.push({ spaceId: "s1", ts: "2026-01-05T11:10:00.000Z", mmol: 9.6, trend: "flat" });
  fake = new FakeLiveDb(() => now);
  fake.addSpace("s1");
  fake.addSpace("s2");
  fake.addMember("owner", "s1", "owner");
  fake.addMember("carer", "s1", "carer");
  fake.addMember("viewer", "s1", "viewer");
  fake.addMember("other", "s2", "owner");
  configureHistory({ repo, sessionDb: fake.db, now: () => now, photos: null });
  logs = captureLog();
});
afterEach(() => {
  configureHistory({});
  vi.restoreAllMocks();
});
describe("history route access and wire contracts", () => {
  it.each([0, 1, 2])(
    "gates route %s before every history read, with the injected session clock",
    async (i) => {
      for (const [session, status] of [
        ["sess-viewer", 403],
        ["sess-other", 404],
        [null, 403],
      ] as const) {
        const response = await required(handlers[i])(session);
        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({
          error: { code: status === 404 ? "not-found" : "forbidden" },
        });
        expect(repo.calls).toEqual([]);
      }
      // These sessions expire months before wall time; the route must use January's injected clock.
      const response = await required(handlers[i])("sess-carer");
      expect(response.status).toBe(200);
      expect(repo.calls.length).toBeGreaterThan(0);
    },
  );
  it("parses all views, omits readings on request, rejects malformed dates and non-Mondays", async () => {
    expect(
      MealCurveView.parse(await (await handlers[0]("sess-owner")).json()).readings[0]?.ts,
    ).toContain("T");
    const view = DayHistoryView.parse(
      await (await handlers[1]("sess-owner", { readings: "0" })).json(),
    );
    expect(view.readings).toEqual([]);
    expect(view.date).toBe("2026-01-05");
    expect(WeekHistoryView.parse(await (await handlers[2]("sess-owner")).json()).days).toHaveLength(
      7,
    );
    for (const value of ["2026-02-30", "yesterday", ""])
      expect((await handlers[1]("sess-owner", { date: value })).status).toBe(400);
    expect((await handlers[1]("sess-owner", { readings: "2" })).status).toBe(400);
    expect((await handlers[2]("sess-owner", { start: "2026-01-06" })).status).toBe(400);
    expect((await handlers[2]("sess-owner", { start: "invalid" })).status).toBe(400);
  });
  it("does not expose meals from another space and logs only allowed metadata", async () => {
    required(repo.meals[0]).spaceId = "s2";
    expect((await handlers[0]("sess-owner")).status).toBe(404);
    required(repo.meals[0]).spaceId = "s1";
    for (const handler of handlers) await handler("sess-owner");
    const all = logs.all();
    expect(all).toContain('"spaceId":"s1"');
    expect(all).toContain('"userId":"owner"');
    for (const secret of [
      "9.6",
      "Private fictional dish",
      "private-note",
      "meal-private",
      "Fictional member",
    ])
      expect(all).not.toContain(secret);
    for (const line of logs.lines)
      expect(
        Object.keys(JSON.parse(line) as Record<string, unknown>).filter(
          (key) =>
            ![
              "ts",
              "msg",
              "level",
              "event",
              "spaceId",
              "userId",
              "route",
              "count",
              "code",
              "ms",
            ].includes(key),
        ),
      ).toEqual([]);
  });
});

describe("simpleMode and pump meals on the history routes (v0.7.0)", () => {
  function simple() {
    fake.addMember("child", "s1", "carer");
    const child = fake.users.find((user) => user.id === "child");
    if (child) child.simpleMode = true;
  }
  it("refuses a simpleMode session on every history read, before any read: no simple screen calls them", async () => {
    simple();
    const all = [
      ...handlers,
      (session: string | null) =>
        insight(liveRequest("s1", "meals/meal-private/insight", session), {
          params: Promise.resolve({ spaceId: "s1", mealId: "meal-private" }),
        }),
      (session: string | null) =>
        weekInsight(liveRequest("s1", "history/week/insight", session, { start: "2026-01-05" }), {
          params: Promise.resolve({ spaceId: "s1" }),
        }),
    ];
    for (const handler of all) {
      const response = await handler("sess-child");
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    }
    expect(repo.calls).toEqual([]);
  });
  it("answers 409 pump-meal for an observation of a pump meal, before any provider is asked", async () => {
    Object.assign(required(repo.meals[0]), {
      source: "pump",
      pumpBolusId: "b1",
      pumpBolus: { units: 1.5, carbs: 40 },
    });
    const response = await insight(liveRequest("s1", "meals/meal-private/insight", "sess-owner"), {
      params: Promise.resolve({ spaceId: "s1", mealId: "meal-private" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "pump-meal" } });
    expect(logs.all()).not.toMatch(/units|carbs|pumpBolus/);
  });
});
