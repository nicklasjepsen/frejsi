// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cookieStoreFor,
  params,
  request,
  seedSpace,
  T0,
  type Who,
} from "@/components/settings/route-test-support";
import { FakeAuthDb, recordingSink, type RecordedEvent } from "@/lib/auth/test-support";

import { GET, POST } from "./route";

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

const CREDENTIAL = { username: "example-publisher", password: "example-secret-pass" };
const BODY = { type: "dexcom-share", region: "eu", ...CREDENTIAL };

let fake: FakeAuthDb;
let events: RecordedEvent[];
let logLines: string[];
/** What the fake source-connect function received, and what it answers. */
let upstream: { calls: { url: string; init: RequestInit }[]; answer: () => Response | Error };

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
  upstream = {
    calls: [],
    answer: () => Response.json({ result: "ok", secretRef: "glucose-s1" }),
  };
  vi.stubEnv("SOURCE_CONNECT_URL", "https://functions.example/api/source-connect");
  vi.stubEnv("SOURCE_CONNECT_KEY", "example-function-key");
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    upstream.calls.push({ url, init });
    const answer = upstream.answer();
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function get(as: Who | null, spaceId = "s1") {
  const req = request(`/api/spaces/${spaceId}/source`, { as });
  shared.holder.request = req;
  return GET(req, params({ spaceId }));
}
function post(as: Who | null, body: unknown = BODY, spaceId = "s1") {
  const req = request(`/api/spaces/${spaceId}/source`, { method: "POST", body, as });
  shared.holder.request = req;
  return POST(req, params({ spaceId }));
}
const space = () => fake.rows("space").find((s) => s.id === "s1") ?? {};

/** Everything the server kept or wrote, as one string to search for the credential in. */
const everythingPersisted = () => JSON.stringify(fake.tables) + logLines.join("\n");

describe("GET /api/spaces/:id/source", () => {
  it("gives owners and carers the source as configured and the time of its last status change, without the secretRef", async () => {
    Object.assign(space(), {
      glucoseSource: JSON.stringify({ type: "dexcom-share", region: "us", secretRef: "glucose-s1" }),
      sourceStatus: "disconnected",
      lastReadingAt: new Date("2026-10-15T13:13:00.000Z"),
    });
    fake.rows("event").push({
      spaceId: "s1",
      seq: 1,
      type: "source.status",
      payload: JSON.stringify({ status: "disconnected", since: "2026-10-15T13:45:00.000Z" }),
      ts: T0,
    });
    const res = await get("carer");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      type: "dexcom-share",
      region: "us",
      status: "disconnected",
      lastReadingAt: "2026-10-15T13:13:00.000Z",
      since: "2026-10-15T13:45:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("glucose-s1");
  });

  it("is all null but the status before a source is configured", async () => {
    expect(await (await get("owner")).json()).toEqual({
      type: null,
      region: null,
      status: "not-configured",
      lastReadingAt: null,
      since: null,
    });
  });

  it("is 403 for a viewer, 404 for a non-member and 403 without a session", async () => {
    expect((await get("viewer")).status).toBe(403);
    expect((await get("stranger")).status).toBe(404);
    expect((await get(null)).status).toBe(403);
  });
});

describe("POST /api/spaces/:id/source (plan task 9: connect a glucose source)", () => {
  it("forwards a ConnectSourceRequest with the spaceId and the function key to source-connect", async () => {
    await post("owner");
    expect(upstream.calls).toHaveLength(1);
    const [call] = upstream.calls;
    expect(call?.url).toBe("https://functions.example/api/source-connect");
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("x-functions-key")).toBe("example-function-key");
    expect(new Headers(call?.init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(call?.init.body as string)).toEqual({ spaceId: "s1", ...BODY });
  });

  it("on ok saves only { type, region, secretRef }, sets connected, emits source.status and space.updated, and answers the settings", async () => {
    Object.assign(space(), { sourceStatus: "disconnected", sourceFailures: 3 });
    const res = await post("owner");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ sourceType: "dexcom-share", sourceStatus: "connected" });
    expect(JSON.parse(String(space().glucoseSource))).toEqual({
      type: "dexcom-share",
      region: "eu",
      secretRef: "glucose-s1",
    });
    expect(space()).toMatchObject({ sourceStatus: "connected", sourceFailures: 0 });
    expect(events).toEqual([
      {
        spaceId: "s1",
        type: "source.status",
        payload: { status: "connected", since: T0.toISOString() },
      },
      { spaceId: "s1", type: "space.updated", payload: { fields: ["glucoseSource", "sourceStatus"] } },
    ]);
  });

  it("never lets the credential reach the database, the log or the response", async () => {
    const ok = await post("owner");
    upstream.answer = () => Response.json({ result: "bad-credentials" });
    const refused = await post("owner");
    upstream.answer = () => new Error("ECONNREFUSED");
    const down = await post("owner");
    const responses = [await ok.text(), await refused.text(), await down.text()].join("\n");
    for (const haystack of [everythingPersisted(), responses]) {
      expect(haystack).not.toContain(CREDENTIAL.password);
      expect(haystack).not.toContain(CREDENTIAL.username);
    }
    // The Prisma calls carry no credential either: nothing but the source JSON was written.
    expect(fake.operations.filter((op) => op.op === "update" && op.table === "space")).not.toEqual(
      [],
    );
  });

  it("answers source-bad-credentials when the function refuses the login and writes nothing", async () => {
    upstream.answer = () => Response.json({ result: "bad-credentials" });
    const res = await post("owner");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "source-bad-credentials" } });
    expect(space()).toMatchObject({ glucoseSource: null, sourceStatus: "not-configured" });
    expect(events).toEqual([]);
  });

  it("answers source-unreachable when the function says so, errors, answers badly or is not configured", async () => {
    upstream.answer = () => Response.json({ result: "unreachable" });
    expect((await post("owner")).status).toBe(503);
    expect(await (await post("owner")).json()).toMatchObject({
      error: { code: "source-unreachable" },
    });
    upstream.answer = () => new Error("ECONNREFUSED");
    expect((await post("owner")).status).toBe(503);
    upstream.answer = () => new Response("<html>oops</html>", { status: 500 });
    expect((await post("owner")).status).toBe(503);
    upstream.answer = () => Response.json({ nonsense: true });
    expect((await post("owner")).status).toBe(503);
    vi.stubEnv("SOURCE_CONNECT_URL", "");
    expect((await post("owner")).status).toBe(503);
    expect(space()).toMatchObject({ glucoseSource: null });
    expect(events).toEqual([]);
  });

  it("is 403 for a carer and a viewer, 404 for a non-member, 403 without a session, and never calls the function for them", async () => {
    expect((await post("carer")).status).toBe(403);
    expect((await post("viewer")).status).toBe(403);
    expect((await post("stranger")).status).toBe(404);
    expect((await post(null)).status).toBe(403);
    expect(upstream.calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("is 400 validation for a body that is not a connect body, without calling the function", async () => {
    expect((await post("owner", { type: "dexcom-share", region: "eu" })).status).toBe(400);
    expect((await post("owner", { ...BODY, spaceId: "s2" })).status).toBe(400);
    expect((await post("owner", { ...BODY, type: "nightscout" })).status).toBe(400);
    expect((await post("owner", "nope")).status).toBe(400);
    expect(upstream.calls).toEqual([]);
  });

  it("logs spaceId and an outcome code only (plan §7)", async () => {
    await post("owner");
    upstream.answer = () => Response.json({ result: "bad-credentials" });
    await post("owner");
    await post("carer");
    expect(logLines.length).toBeGreaterThanOrEqual(3);
    const codes: string[] = [];
    for (const line of logLines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.spaceId).toBe("s1");
      expect(typeof parsed.code).toBe("string");
      codes.push(parsed.code as string);
      for (const key of Object.keys(parsed)) {
        expect(["ts", "level", "msg", "route", "code", "spaceId", "error"]).toContain(key);
      }
    }
    expect(codes).toEqual(expect.arrayContaining(["ok", "source-bad-credentials", "forbidden"]));
    expect(logLines.join("\n")).not.toMatch(/Example|example-/);
  });
});
