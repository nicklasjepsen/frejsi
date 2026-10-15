// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cookieStoreFor,
  params,
  request,
  seedSpace,
  T0,
  USERS,
  type Who,
} from "@/components/settings/route-test-support";
import { FakeAuthDb, recordingSink, type RecordedEvent } from "@/lib/auth/test-support";

import { PATCH as patchMember } from "./members/[userId]/route";
import { GET, PATCH } from "./route";

const shared = vi.hoisted(() => {
  const holder: { db: Record<string, unknown>; sink: EventSink; request: Request | null } = {
    db: {},
    sink: { publish: () => Promise.resolve() },
    request: null,
  };
  const sink: EventSink = { publish: (group, envelope) => holder.sink.publish(group, envelope) };
  return {
    holder,
    prisma: new Proxy({}, { get: (_target, key: string) => holder.db[key] }),
    sink,
  };
});
vi.mock("@frejsi/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: shared.prisma,
  createEventSinkFromEnv: () => shared.sink,
}));
vi.mock("next/headers", () => ({ cookies: cookieStoreFor(() => shared.holder.request) }));

let fake: FakeAuthDb;
let events: RecordedEvent[];
let logLines: string[];

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  fake = new FakeAuthDb(() => T0);
  seedSpace(fake);
  const recorder = recordingSink();
  events = recorder.events;
  shared.holder.db = fake.db as unknown as Record<string, unknown>;
  shared.holder.sink = recorder.sink;
  logLines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    logLines.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function get(as: Who | null, spaceId = "s1") {
  const req = request(`/api/spaces/${spaceId}/settings`, { as });
  shared.holder.request = req;
  return GET(req, params({ spaceId }));
}
function patch(as: Who | null, body: unknown, spaceId = "s1") {
  const req = request(`/api/spaces/${spaceId}/settings`, { method: "PATCH", body, as });
  shared.holder.request = req;
  return PATCH(req, params({ spaceId }));
}
function patchFor(as: Who | null, userId: string, body: unknown, spaceId = "s1") {
  const req = request(`/api/spaces/${spaceId}/settings/members/${userId}`, { method: "PATCH", body, as });
  shared.holder.request = req;
  return patchMember(req, params({ spaceId, userId }));
}

describe("GET /api/spaces/:id/settings", () => {
  it("gives owners and carers the space settings in the shared shape", async () => {
    const res = await get("carer");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Example space",
      timezone: "Europe/Copenhagen",
      glucoseUnit: "mmol",
      targetLow: 4,
      targetHigh: 10,
      sourceType: null,
      sourceStatus: "not-configured",
      lastReadingAt: null,
    });
  });

  it("is 403 for a viewer, 404 for a non-member and 403 without a session", async () => {
    expect((await get("viewer")).status).toBe(403);
    expect(await (await get("viewer")).json()).toMatchObject({ error: { code: "forbidden" } });
    expect((await get("stranger")).status).toBe(404);
    expect((await get(null)).status).toBe(403);
  });
});

describe("PATCH /api/spaces/:id/settings", () => {
  it("lets an owner change the unit and the target range, emits space.updated and answers with the new values", async () => {
    const res = await patch("owner", { glucoseUnit: "mgdl", targetLow: 3.9, targetHigh: 9.5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ glucoseUnit: "mgdl", targetLow: 3.9, targetHigh: 9.5 });
    expect(events).toEqual([
      {
        spaceId: "s1",
        type: "space.updated",
        payload: { fields: ["glucoseUnit", "targetLow", "targetHigh"] },
      },
    ]);
  });

  it("is 403 for a carer and a viewer, 404 for a non-member, and writes nothing", async () => {
    expect((await patch("carer", { glucoseUnit: "mgdl" })).status).toBe(403);
    expect((await patch("viewer", { glucoseUnit: "mgdl" })).status).toBe(403);
    expect((await patch("stranger", { glucoseUnit: "mgdl" })).status).toBe(404);
    expect(fake.rows("space")[0]).toMatchObject({ glucoseUnit: "mmol" });
    expect(events).toEqual([]);
  });

  it("is 400 validation for an empty patch, a bad unit or a crossed range", async () => {
    expect((await patch("owner", {})).status).toBe(400);
    expect((await patch("owner", { glucoseUnit: "mmol/L" })).status).toBe(400);
    expect((await patch("owner", { targetLow: 11 })).status).toBe(400);
    expect((await patch("owner", "nope")).status).toBe(400);
    expect(events).toEqual([]);
  });
});

describe("PATCH /api/spaces/:id/settings/members/:userId", () => {
  it("lets an owner set a member's view, colour and language, emitting member.updated to each of that member's spaces", async () => {
    const res = await patchFor("owner", USERS.carer, { simpleMode: true, accent: "forest" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "da", simpleMode: true, accent: "forest" });
    expect(fake.rows("user").find((u) => u.id === USERS.carer)).toMatchObject({ simpleMode: true });
    expect(events).toEqual([
      { spaceId: "s1", type: "member.updated", payload: { userId: USERS.carer } },
      { spaceId: "s2", type: "member.updated", payload: { userId: USERS.carer } },
    ]);
  });

  it("is 403 for a carer or viewer setting someone else, and 404 for a user who is not in the space", async () => {
    expect((await patchFor("carer", USERS.viewer, { accent: "plum" })).status).toBe(403);
    expect((await patchFor("viewer", USERS.carer, { accent: "plum" })).status).toBe(403);
    expect((await patchFor("owner", USERS.stranger, { accent: "plum" })).status).toBe(404);
    expect((await patchFor("owner", "nobody", { accent: "plum" })).status).toBe(404);
    expect(events).toEqual([]);
  });

  it("logs spaceId, userId and a code only; never a name", async () => {
    await patch("owner", { glucoseUnit: "mgdl" });
    await patch("carer", { glucoseUnit: "mgdl" });
    await patchFor("owner", USERS.carer, { accent: "sea" });
    await patchFor("owner", USERS.stranger, { accent: "sea" });
    expect(logLines.length).toBeGreaterThanOrEqual(4);
    for (const line of logLines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.spaceId).toBe("s1");
      expect(typeof parsed.code).toBe("string");
      for (const key of Object.keys(parsed)) {
        expect(["ts", "level", "msg", "route", "code", "spaceId", "userId", "error"]).toContain(key);
      }
    }
    expect(logLines.join("\n")).not.toMatch(/Example/);
  });
});
