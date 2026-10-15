// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cookieStoreFor,
  request,
  seedSpace,
  T0,
  USERS,
} from "@/components/settings/route-test-support";
import { FakeAuthDb, recordingSink, type RecordedEvent } from "@/lib/auth/test-support";

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

const send = (fn: typeof GET, req: Request) => {
  shared.holder.request = req;
  return fn(req);
};

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

describe("GET /api/users/me", () => {
  it("returns the signed-in user's own settings", async () => {
    const res = await send(GET, request("/api/users/me", { as: "carer" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "da", simpleMode: false, accent: "olive" });
  });

  it("is 403 without a session", async () => {
    const res = await send(GET, request("/api/users/me", { as: null }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});

describe("PATCH /api/users/me", () => {
  it("lets a person set their own language, view and colour, and emits member.updated to each of their spaces", async () => {
    const res = await send(
      PATCH,
      request("/api/users/me", { method: "PATCH", body: { locale: "en", accent: "sea", simpleMode: true }, as: "carer" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "en", simpleMode: true, accent: "sea" });
    expect(fake.rows("user").find((u) => u.id === USERS.carer)).toMatchObject({
      locale: "en",
      accent: "sea",
      simpleMode: true,
    });
    expect(events).toEqual([
      { spaceId: "s1", type: "member.updated", payload: { userId: USERS.carer } },
      { spaceId: "s2", type: "member.updated", payload: { userId: USERS.carer } },
    ]);
  });

  it("lets a viewer set only language and colour: simpleMode is 403 and writes nothing", async () => {
    const ok = await send(
      PATCH,
      request("/api/users/me", { method: "PATCH", body: { locale: "en", accent: "garnet" }, as: "viewer" }),
    );
    expect(ok.status).toBe(200);
    expect(events).toEqual([{ spaceId: "s1", type: "member.updated", payload: { userId: USERS.viewer } }]);

    const refused = await send(
      PATCH,
      request("/api/users/me", { method: "PATCH", body: { simpleMode: true }, as: "viewer" }),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(fake.rows("user").find((u) => u.id === USERS.viewer)).toMatchObject({ simpleMode: false });
    expect(events).toHaveLength(1);
  });

  it("is 400 validation for an empty or unknown patch and 403 without a session", async () => {
    expect((await send(PATCH, request("/api/users/me", { method: "PATCH", body: {}, as: "owner" }))).status).toBe(400);
    expect((await send(PATCH, request("/api/users/me", { method: "PATCH", body: { name: "x" }, as: "owner" }))).status).toBe(400);
    expect((await send(PATCH, request("/api/users/me", { method: "PATCH", body: "nope", as: "owner" }))).status).toBe(400);
    expect((await send(PATCH, request("/api/users/me", { method: "PATCH", body: { accent: "plum" }, as: null }))).status).toBe(403);
    expect(events).toEqual([]);
  });

  it("logs the route, the userId and a code only; never a name", async () => {
    await send(PATCH, request("/api/users/me", { method: "PATCH", body: { accent: "plum" }, as: "owner" }));
    await send(PATCH, request("/api/users/me", { method: "PATCH", body: { simpleMode: true }, as: "viewer" }));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(
        expect.arrayContaining(["code", "level", "msg", "route", "ts"]),
      );
      for (const key of Object.keys(parsed)) {
        expect(["ts", "level", "msg", "route", "code", "userId", "error"]).toContain(key);
      }
    }
    expect(logLines.join("\n")).not.toMatch(/Example/);
  });
});
