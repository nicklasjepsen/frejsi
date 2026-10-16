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
      glucoseSource: JSON.stringify({
        type: "dexcom-share",
        region: "us",
        secretRef: "glucose-s1",
      }),
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
      {
        spaceId: "s1",
        type: "space.updated",
        payload: { fields: ["glucoseSource", "sourceStatus"] },
      },
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

  it("names why the function was unreachable on a warn line, without request data", async () => {
    const causes = (): string[] =>
      logLines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line.msg === "source.connect-unreachable")
        .map((line) => {
          expect(line).toMatchObject({ level: "warn", route: "spaces.source", spaceId: "s1" });
          return line.code as string;
        });
    upstream.answer = () => new Error("ECONNREFUSED");
    await post("owner");
    upstream.answer = () => new Response("<html>oops</html>", { status: 502 });
    await post("owner");
    upstream.answer = () => Response.json({ nonsense: true });
    await post("owner");
    upstream.answer = () => Response.json({ result: "unreachable" });
    await post("owner");
    vi.stubEnv("SOURCE_CONNECT_URL", "");
    await post("owner");
    expect(causes()).toEqual([
      "network",
      "http-502",
      "bad-body",
      "source-unreachable",
      "not-configured",
    ]);
    expect(logLines.join("\n")).not.toMatch(/example-/);
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

const NS_URL = "https://nightscout.example.test";
const NS_TOKEN = "example-ns-token-0123";
const NS_BODY = { type: "nightscout", url: NS_URL, token: NS_TOKEN };

describe("POST /api/spaces/:id/source · nightscout", () => {
  it("forwards the union body with the spaceId to source-connect", async () => {
    await post("owner", NS_BODY);
    expect(upstream.calls).toHaveLength(1);
    expect(JSON.parse(upstream.calls[0]?.init.body as string)).toEqual({
      spaceId: "s1",
      ...NS_BODY,
    });
  });

  it("accepts an API-secret in place of a token", async () => {
    const res = await post("owner", {
      type: "nightscout",
      url: NS_URL,
      apiSecret: "example-secret-12",
    });
    expect(res.status).toBe(200);
  });

  it("on ok saves only { type, secretRef }, sets connected, resets failures and emits the two events", async () => {
    Object.assign(space(), { sourceStatus: "disconnected", sourceFailures: 4 });
    const res = await post("owner", NS_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sourceType: "nightscout", sourceStatus: "connected" });
    expect(JSON.parse(String(space().glucoseSource))).toEqual({
      type: "nightscout",
      secretRef: "glucose-s1",
    });
    expect(space()).toMatchObject({ sourceStatus: "connected", sourceFailures: 0 });
    expect(events).toEqual([
      {
        spaceId: "s1",
        type: "source.status",
        payload: { status: "connected", since: T0.toISOString() },
      },
      {
        spaceId: "s1",
        type: "space.updated",
        payload: { fields: ["glucoseSource", "sourceStatus"] },
      },
    ]);
  });

  it("never lets the URL or the token reach the database, the log or a response", async () => {
    const ok = await post("owner", NS_BODY);
    upstream.answer = () => Response.json({ result: "bad-credentials" });
    const refused = await post("owner", NS_BODY);
    upstream.answer = () => new Error(`ECONNREFUSED ${NS_URL}`);
    const down = await post("owner", NS_BODY);
    const bad = await post("owner", { ...NS_BODY, url: "http://nightscout.example.test/?token=x" });
    const responses = [ok, refused, down, bad].map((r) => r.text());
    const haystacks = [everythingPersisted(), (await Promise.all(responses)).join("\n")];
    for (const haystack of haystacks) {
      expect(haystack).not.toContain(NS_TOKEN);
      expect(haystack).not.toContain("nightscout.example.test");
    }
  });

  it("maps bad-credentials and unreachable and writes nothing", async () => {
    upstream.answer = () => Response.json({ result: "bad-credentials" });
    const refused = await post("owner", NS_BODY);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "source-bad-credentials" } });
    upstream.answer = () => Response.json({ result: "unreachable" });
    const down = await post("owner", NS_BODY);
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ error: { code: "source-unreachable" } });
    expect(space()).toMatchObject({ glucoseSource: null, sourceStatus: "not-configured" });
    expect(events).toEqual([]);
  });

  it("rejects a URL that is not https, or has a query or fragment, with source-url-invalid before any call", async () => {
    for (const url of [
      "http://nightscout.example.test",
      "https://nightscout.example.test/?token=abc",
      "https://nightscout.example.test/#x",
      "ftp://nightscout.example.test",
      "not a url",
    ]) {
      const res = await post("owner", { ...NS_BODY, url });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "source-url-invalid" } });
    }
    expect(upstream.calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("is 400 validation when neither or both of token and apiSecret are given", async () => {
    expect((await post("owner", { type: "nightscout", url: NS_URL })).status).toBe(400);
    expect((await post("owner", { ...NS_BODY, apiSecret: "example-secret-12" })).status).toBe(400);
    expect(upstream.calls).toEqual([]);
  });

  it("is 403 for a carer and a viewer", async () => {
    expect((await post("carer", NS_BODY)).status).toBe(403);
    expect((await post("viewer", NS_BODY)).status).toBe(403);
    expect(upstream.calls).toEqual([]);
  });
});

describe("POST /api/spaces/:id/source · manual", () => {
  it("calls no source-connect, saves { type: manual }, sets connected and emits the two events", async () => {
    Object.assign(space(), {
      glucoseSource: JSON.stringify({ type: "nightscout", secretRef: "glucose-s1" }),
      sourceStatus: "disconnected",
      sourceFailures: 2,
    });
    const res = await post("owner", { type: "manual" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sourceType: "manual", sourceStatus: "connected" });
    expect(upstream.calls).toEqual([]);
    expect(JSON.parse(String(space().glucoseSource))).toEqual({ type: "manual" });
    expect(space()).toMatchObject({ sourceStatus: "connected", sourceFailures: 0 });
    expect(events.map((e) => e.type)).toEqual(["source.status", "space.updated"]);
    expect(events[1]?.payload).toEqual({ fields: ["glucoseSource", "sourceStatus"] });
  });

  it("is 403 for a carer and a viewer and writes nothing", async () => {
    expect((await post("carer", { type: "manual" })).status).toBe(403);
    expect((await post("viewer", { type: "manual" })).status).toBe(403);
    expect(space()).toMatchObject({ glucoseSource: null });
    expect(events).toEqual([]);
  });

  it("GET reports the manual type with no region", async () => {
    await post("owner", { type: "manual" });
    expect(await (await get("carer")).json()).toMatchObject({
      type: "manual",
      region: null,
      status: "connected",
    });
  });
});
