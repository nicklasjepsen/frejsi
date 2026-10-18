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

import { DELETE, GET, POST } from "./route";

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

const NS_URL = "https://nightscout.example.test";
const NS_TOKEN = "example-ns-token-0123";
const BODY = { type: "nightscout", url: NS_URL, token: NS_TOKEN };

let fake: FakeAuthDb;
let events: RecordedEvent[];
let logLines: string[];
/** Every call the route made to the stored boluses: there must be none. */
let bolusCalls: string[];
/** What the fake source-connect function received, and what it answers. */
let upstream: { calls: { url: string; init: RequestInit }[]; answer: () => Response | Error };

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  fake = new FakeAuthDb(() => T0);
  seedSpace(fake);
  for (const row of fake.rows("space")) {
    Object.assign(row, {
      pumpSource: null,
      pumpStatus: "not-configured",
      pumpFailures: 0,
      lastPumpAt: null,
    });
  }
  const recorder = recordingSink();
  events = recorder.events;
  bolusCalls = [];
  const pumpBolus = new Proxy(
    {},
    {
      get: (_target, key: string) => () => {
        bolusCalls.push(key);
        return Promise.resolve(null);
      },
    },
  );
  shared.holder.db = { ...(fake.db as unknown as Record<string, unknown>), pumpBolus };
  shared.holder.sink = recorder.sink;
  logLines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    logLines.push(String(chunk));
    return true;
  });
  upstream = {
    calls: [],
    answer: () => Response.json({ result: "ok", secretRef: "pump-s1/0123abcd", recentBoluses: 6 }),
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

const path = (spaceId: string) => `/api/spaces/${spaceId}/pump-source`;
function get(as: Who | null, spaceId = "s1") {
  const req = request(path(spaceId), { as });
  shared.holder.request = req;
  return GET(req, params({ spaceId }));
}
function post(as: Who | null, body: unknown = BODY, spaceId = "s1") {
  const req = request(path(spaceId), { method: "POST", body, as });
  shared.holder.request = req;
  return POST(req, params({ spaceId }));
}
function del(as: Who | null, spaceId = "s1") {
  const req = request(path(spaceId), { method: "DELETE", as });
  shared.holder.request = req;
  return DELETE(req, params({ spaceId }));
}
const space = () => fake.rows("space").find((s) => s.id === "s1") ?? {};
const inSimpleMode = (who: Who) => {
  const user = fake.rows("user").find((u) => u.id === USERS[who]);
  if (user) user.simpleMode = true;
};
const connectedConfig = {
  type: "nightscout",
  secretRef: "pump-s1/0123abcd",
  connectedBy: "u-owner",
};

/** Everything the server kept or wrote, as one string to search for the credential in. */
const everythingPersisted = () => JSON.stringify(fake.tables) + logLines.join("\n");

describe("GET /api/spaces/:id/pump-source (spec §3, plan task 3)", () => {
  it("gives an owner and a carer the PumpSettingsView: status, since, the newest record, configured", async () => {
    Object.assign(space(), {
      pumpSource: JSON.stringify(connectedConfig),
      pumpStatus: "disconnected",
      pumpFailures: 3,
      lastPumpAt: new Date("2026-10-15T09:58:00.000Z"),
    });
    fake.rows("event").push({
      spaceId: "s1",
      seq: 1,
      type: "pump.status",
      payload: JSON.stringify({ status: "connected", since: "2026-10-14T08:00:00.000Z" }),
      ts: T0,
    });
    fake.rows("event").push({
      spaceId: "s1",
      seq: 2,
      type: "pump.status",
      payload: JSON.stringify({ status: "disconnected", since: "2026-10-15T12:05:00.000Z" }),
      ts: T0,
    });
    for (const who of ["owner", "carer"] as const) {
      const res = await get(who);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        status: "disconnected",
        since: "2026-10-15T12:05:00.000Z",
        lastPumpAt: "2026-10-15T09:58:00.000Z",
        configured: true,
      });
      expect(JSON.stringify(body)).not.toContain("pump-s1");
      expect(JSON.stringify(body)).not.toContain("u-owner");
    }
  });

  it("is not configured, with no times, before a pump record is connected", async () => {
    expect(await (await get("owner")).json()).toEqual({
      status: "not-configured",
      configured: false,
    });
  });

  it("is 403 for a viewer, in the API, and the space row is never read for them", async () => {
    Object.assign(space(), {
      pumpSource: JSON.stringify(connectedConfig),
      pumpStatus: "connected",
    });
    const res = await get("viewer");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(fake.operations.filter((op) => op.table === "space")).toEqual([]);
  });

  it("is 403 for a simpleMode session, owner or carer, in the API", async () => {
    Object.assign(space(), {
      pumpSource: JSON.stringify(connectedConfig),
      pumpStatus: "connected",
    });
    inSimpleMode("carer");
    expect((await get("carer")).status).toBe(403);
    inSimpleMode("owner");
    expect((await get("owner")).status).toBe(403);
    expect(fake.operations.filter((op) => op.table === "space")).toEqual([]);
  });

  it("is 404 for a non-member and 403 without a session", async () => {
    expect((await get("stranger")).status).toBe(404);
    expect((await get(null)).status).toBe(403);
  });
});

describe("POST /api/spaces/:id/pump-source (connect the pump record)", () => {
  it("forwards a ConnectPumpRequest with purpose pump, the spaceId and the function key", async () => {
    await post("owner");
    expect(upstream.calls).toHaveLength(1);
    const [call] = upstream.calls;
    expect(call?.url).toBe("https://functions.example/api/source-connect");
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("x-functions-key")).toBe("example-function-key");
    expect(JSON.parse(call?.init.body as string)).toEqual({
      purpose: "pump",
      spaceId: "s1",
      ...BODY,
    });
  });

  it("accepts an API secret in place of a token", async () => {
    const res = await post("owner", {
      type: "nightscout",
      url: NS_URL,
      apiSecret: "example-secret-12",
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(upstream.calls[0]?.init.body as string)).toMatchObject({
      apiSecret: "example-secret-12",
    });
  });

  it("on ok stores { type, secretRef, connectedBy } only, sets connected, emits, and answers the view with recentBoluses", async () => {
    Object.assign(space(), { pumpStatus: "disconnected", pumpFailures: 3 });
    const res = await post("owner");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "connected",
      since: T0.toISOString(),
      configured: true,
      recentBoluses: 6,
    });
    expect(JSON.parse(String(space().pumpSource))).toEqual(connectedConfig);
    expect(space()).toMatchObject({ pumpStatus: "connected", pumpFailures: 0 });
    // The glucose source is a separate connection and is left as it was.
    expect(space()).toMatchObject({ glucoseSource: null, sourceStatus: "not-configured" });
    expect(events).toEqual([
      {
        spaceId: "s1",
        type: "pump.status",
        payload: { status: "connected", since: T0.toISOString() },
      },
      { spaceId: "s1", type: "space.updated", payload: { fields: ["pumpSource"] } },
    ]);
  });

  it("answers recentBoluses 0 as a working connection, and leaves it out when the function sent none", async () => {
    upstream.answer = () => Response.json({ result: "ok", secretRef: "pump-s1", recentBoluses: 0 });
    const none = await post("owner");
    expect(none.status).toBe(200);
    expect(await none.json()).toMatchObject({ status: "connected", recentBoluses: 0 });
    upstream.answer = () => Response.json({ result: "ok", secretRef: "pump-s1" });
    expect(await (await post("owner")).json()).not.toHaveProperty("recentBoluses");
  });

  it("refuses a reference to any secret but pump-<spaceId>, as unreachable, and stores nothing", async () => {
    for (const secretRef of ["glucose-s1", "glucose-s1/abc", "pump-s2/abc", "pump-s1x"]) {
      upstream.answer = () => Response.json({ result: "ok", secretRef });
      const res = await post("owner");
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: { code: "source-unreachable" } });
    }
    expect(space()).toMatchObject({ pumpSource: null, pumpStatus: "not-configured" });
    expect(events).toEqual([]);
  });

  it("maps bad-credentials to source-bad-credentials and unreachable to source-unreachable, writing nothing", async () => {
    upstream.answer = () => Response.json({ result: "bad-credentials" });
    const refused = await post("owner");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "source-bad-credentials" } });
    for (const answer of [
      () => Response.json({ result: "unreachable" }),
      () => new Error("ECONNREFUSED"),
      () => new Response("<html>oops</html>", { status: 500 }),
      () => Response.json({ nonsense: true }),
    ]) {
      upstream.answer = answer;
      const down = await post("owner");
      expect(down.status).toBe(503);
      expect(await down.json()).toMatchObject({ error: { code: "source-unreachable" } });
    }
    vi.stubEnv("SOURCE_CONNECT_URL", "");
    expect((await post("owner")).status).toBe(503);
    expect(space()).toMatchObject({ pumpSource: null, pumpStatus: "not-configured" });
    expect(events).toEqual([]);
  });

  it("rejects a bad address with source-url-invalid before any call", async () => {
    for (const url of [
      "http://nightscout.example.test",
      "https://nightscout.example.test/?token=abc",
      "https://nightscout.example.test/#x",
      "ftp://nightscout.example.test",
      "not a url",
    ]) {
      const res = await post("owner", { ...BODY, url });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "source-url-invalid" } });
    }
    expect(upstream.calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("is 400 validation for neither or both secrets, a spaceId, a purpose, another type or no JSON", async () => {
    for (const body of [
      { type: "nightscout", url: NS_URL },
      { ...BODY, apiSecret: "example-secret-12" },
      { ...BODY, spaceId: "s2" },
      { ...BODY, purpose: "pump" },
      { ...BODY, type: "dexcom-share" },
      "nope",
    ]) {
      const res = await post("owner", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "validation" } });
    }
    expect(upstream.calls).toEqual([]);
  });

  it("is owner only: 403 for a carer, a viewer and a simpleMode owner, 404 for a non-member, never calling the function", async () => {
    expect((await post("carer")).status).toBe(403);
    expect((await post("viewer")).status).toBe(403);
    expect((await post("stranger")).status).toBe(404);
    expect((await post(null)).status).toBe(403);
    inSimpleMode("owner");
    expect((await post("owner")).status).toBe(403);
    expect(upstream.calls).toEqual([]);
    expect(events).toEqual([]);
    expect(space()).toMatchObject({ pumpSource: null });
  });
});

describe("DELETE /api/spaces/:id/pump-source (disconnect, keep the history)", () => {
  beforeEach(() => {
    Object.assign(space(), {
      pumpSource: JSON.stringify(connectedConfig),
      pumpStatus: "disconnected",
      pumpFailures: 4,
      lastPumpAt: new Date("2026-10-15T07:58:00.000Z"),
    });
  });

  it("clears pumpSource, sets not-configured, keeps the stored boluses and emits", async () => {
    const res = await del("owner");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "not-configured",
      since: T0.toISOString(),
      lastPumpAt: "2026-10-15T07:58:00.000Z",
      configured: false,
    });
    expect(space()).toMatchObject({
      pumpSource: null,
      pumpStatus: "not-configured",
      pumpFailures: 0,
      lastPumpAt: new Date("2026-10-15T07:58:00.000Z"),
    });
    // The pump history stays: the route never touches a stored bolus.
    expect(bolusCalls).toEqual([]);
    expect(events).toEqual([
      {
        spaceId: "s1",
        type: "pump.status",
        payload: { status: "not-configured", since: T0.toISOString() },
      },
      { spaceId: "s1", type: "space.updated", payload: { fields: ["pumpSource"] } },
    ]);
  });

  it("writes and emits nothing when there is no pump record to disconnect", async () => {
    Object.assign(space(), { pumpSource: null, pumpStatus: "not-configured", pumpFailures: 0 });
    const res = await del("owner");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "not-configured", configured: false });
    expect(events).toEqual([]);
    expect(fake.operations.filter((op) => op.op === "update")).toEqual([]);
  });

  it("is owner only: 403 for a carer, a viewer and a simpleMode owner, writing nothing", async () => {
    expect((await del("carer")).status).toBe(403);
    expect((await del("viewer")).status).toBe(403);
    expect((await del("stranger")).status).toBe(404);
    inSimpleMode("owner");
    expect((await del("owner")).status).toBe(403);
    expect(events).toEqual([]);
    expect(JSON.parse(String(space().pumpSource))).toEqual(connectedConfig);
  });
});

describe("the credential never leaves the request (spec §3, log capture)", () => {
  it("finds no address or token stored, logged or echoed, on any outcome", async () => {
    const responses: Response[] = [];
    responses.push(await post("owner"));
    upstream.answer = () => Response.json({ result: "bad-credentials" });
    responses.push(await post("owner"));
    upstream.answer = () => new Error(`ECONNREFUSED ${NS_URL}`);
    responses.push(await post("owner"));
    responses.push(
      await post("owner", { ...BODY, url: "http://nightscout.example.test/?token=x" }),
    );
    responses.push(await post("owner", { ...BODY, apiSecret: NS_TOKEN }));
    responses.push(await post("carer"));
    responses.push(await get("owner"));
    responses.push(await del("owner"));
    const texts = (await Promise.all(responses.map((r) => r.text()))).join("\n");
    for (const haystack of [everythingPersisted(), texts]) {
      expect(haystack).not.toContain(NS_TOKEN);
      expect(haystack).not.toContain("nightscout.example.test");
    }
  });

  it("logs the route, an outcome code and the spaceId only", async () => {
    await post("owner");
    upstream.answer = () => Response.json({ result: "unreachable" });
    await post("owner");
    await post("carer");
    await del("owner");
    expect(logLines.length).toBeGreaterThanOrEqual(4);
    const codes: string[] = [];
    for (const line of logLines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.spaceId).toBe("s1");
      codes.push(parsed.code as string);
      for (const key of Object.keys(parsed)) {
        expect(["ts", "level", "msg", "route", "code", "spaceId", "error"]).toContain(key);
      }
    }
    expect(codes).toEqual(expect.arrayContaining(["ok", "source-unreachable", "forbidden"]));
    expect(logLines.join("\n")).not.toMatch(/Example|example-|u-owner/);
  });
});
