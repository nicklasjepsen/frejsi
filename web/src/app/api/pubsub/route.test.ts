// @vitest-environment node
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as negotiateGET } from "@/app/api/spaces/[spaceId]/negotiate/route";
import { configureLive } from "@/lib/live/server";
import {
  captureLog,
  FakeLiveDb,
  liveRequest,
  RecordingIssuer,
  spaceContext,
} from "@/lib/live/test-support";
import { upstreamConfigFrom, type UpstreamConfig } from "@/lib/live/upstream";

import { OPTIONS, POST } from "./route";

const T0 = new Date("2026-10-15T13:13:00.000Z");
const ORIGIN = "wps-frejsi-example.webpubsub.azure.com";
// Fictional; never a real key. The web app reads the real one from WEB_PUBSUB_CONNECTION_STRING.
const ACCESS_KEY = "fictional-access-key-for-tests-only";
const CONNECTION_STRING = `Endpoint=https://${ORIGIN};AccessKey=${ACCESS_KEY};Version=1.0;`;

interface Fixture {
  headers: Record<string, string>;
  body: { query: Record<string, string[]> } & Record<string, unknown>;
}
const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/connect-event.json"), "utf8"),
) as Fixture;

const sign = (connectionId: string, key = ACCESS_KEY) =>
  `sha256=${createHmac("sha256", key).update(connectionId).digest("hex")}`;

interface ConnectOptions {
  userId?: string | null;
  query?: Record<string, string[]>;
  headers?: Record<string, string | null>;
}

/** The fixture's connect event for `userId` asking for the space in `query`, signed with the key. */
function connectEvent({ userId = "owner-1", query, headers = {} }: ConnectOptions = {}): Request {
  const all = new Headers(fixture.headers);
  if (userId !== null) all.set("ce-userId", userId);
  const connectionId = all.get("ce-connectionId") ?? "";
  all.set("ce-signature", `${sign(connectionId, "secondary-key")},${sign(connectionId)}`);
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) all.delete(name);
    else all.set(name, value);
  }
  const body = {
    ...fixture.body,
    query: query ?? { ...fixture.body.query, spaceId: ["s1"] },
  };
  return new Request("https://frejsi.example/api/pubsub", {
    method: "POST",
    headers: all,
    body: JSON.stringify(body),
  });
}

/** The query the service forwards for a socket URL: every parameter as a list of values. */
function forwardedQuery(url: string): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  for (const [key, value] of new URL(url).searchParams) (query[key] ??= []).push(value);
  return query;
}

let fake: FakeLiveDb;
let upstream: UpstreamConfig | null;
let logs: ReturnType<typeof captureLog>;

beforeEach(() => {
  fake = new FakeLiveDb(() => T0);
  fake.addSpace("s1");
  fake.addMember("owner-1", "s1", "owner");
  fake.addMember("carer-1", "s1", "carer");
  fake.addMember("viewer-1", "s1", "viewer");
  fake.addSpace("s2");
  fake.addMember("other-1", "s2", "owner");
  upstream = upstreamConfigFrom({ WEB_PUBSUB_CONNECTION_STRING: CONNECTION_STRING });
  configureLive({ db: fake.db, issuer: new RecordingIssuer(), now: () => T0, upstream });
  logs = captureLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  configureLive({});
});

async function groupsOf(response: Response): Promise<string[]> {
  expect(response.status).toBe(200);
  const body = (await response.json()) as { groups: string[] };
  return body.groups;
}

describe("OPTIONS /api/pubsub: CloudEvents abuse protection", () => {
  it("allows its own Web PubSub origin and nothing else", async () => {
    const own = await OPTIONS(
      new Request("https://frejsi.example/api/pubsub", {
        method: "OPTIONS",
        headers: { "WebHook-Request-Origin": ORIGIN },
      }),
    );
    expect(own.status).toBe(200);
    expect(own.headers.get("WebHook-Allowed-Origin")).toBe(ORIGIN);

    const other = await OPTIONS(
      new Request("https://frejsi.example/api/pubsub", {
        method: "OPTIONS",
        headers: { "WebHook-Request-Origin": "someone-else.webpubsub.azure.com" },
      }),
    );
    expect(other.status).toBe(403);
    expect(other.headers.get("WebHook-Allowed-Origin")).toBeNull();
  });
});

describe("POST /api/pubsub: the connect event grants the groups of the current role (issue #95)", () => {
  it("joins an owner and a carer to the space and its glucose group", async () => {
    expect(await groupsOf(await POST(connectEvent({ userId: "owner-1" })))).toEqual([
      "space-s1",
      "space-s1-glucose",
    ]);
    expect(await groupsOf(await POST(connectEvent({ userId: "carer-1" })))).toEqual([
      "space-s1",
      "space-s1-glucose",
    ]);
  });

  it("never joins a viewer to the glucose group", async () => {
    expect(await groupsOf(await POST(connectEvent({ userId: "viewer-1" })))).toEqual(["space-s1"]);
  });

  it("does not join a carer downgraded to viewer to the glucose group with the token from before", async () => {
    const negotiated = await negotiateGET(
      liveRequest("s1", "negotiate", "sess-carer-1"),
      spaceContext("s1"),
    );
    expect(negotiated.status).toBe(200);
    const { url } = (await negotiated.json()) as { url: string };

    // The owner downgrades the carer; the client reconnects with the URL it already had.
    const membership = fake.users.find((u) => u.id === "carer-1")?.memberships[0];
    if (!membership) throw new Error("fixture: carer-1 has no membership");
    membership.role = "viewer";

    const groups = await groupsOf(
      await POST(connectEvent({ userId: "carer-1", query: forwardedQuery(url) })),
    );
    expect(groups).toEqual(["space-s1"]);
    expect(groups.some((g) => g.includes("glucose"))).toBe(false);
  });

  it("refuses a non-member and a removed member, joining nothing", async () => {
    const stranger = await POST(connectEvent({ userId: "other-1" }));
    expect(stranger.status).toBe(403);
    expect(await stranger.text()).not.toContain("space-");

    fake.users = fake.users.filter((u) => u.id !== "carer-1");
    const removed = await POST(connectEvent({ userId: "carer-1" }));
    expect(removed.status).toBe(403);
  });

  it("refuses a connection without a user or without exactly one space", async () => {
    expect((await POST(connectEvent({ userId: null }))).status).toBe(401);
    expect((await POST(connectEvent({ query: {} }))).status).toBe(400);
    expect((await POST(connectEvent({ query: { spaceId: ["s1", "s2"] } }))).status).toBe(400);
    expect((await POST(connectEvent({ query: { spaceId: [""] } }))).status).toBe(400);
  });
});

describe("POST /api/pubsub: only the Web PubSub service can call it", () => {
  it("refuses a missing or forged signature", async () => {
    const missing = await POST(connectEvent({ headers: { "ce-signature": null } }));
    expect(missing.status).toBe(401);
    const forged = await POST(
      connectEvent({ headers: { "ce-signature": sign("conn-0001", "a-guessed-key") } }),
    );
    expect(forged.status).toBe(401);
    // Signed for another connection: the signature covers the connection id.
    const replayed = await POST(
      connectEvent({
        headers: { "ce-signature": sign("conn-0002"), "ce-connectionId": "conn-0001" },
      }),
    );
    expect(replayed.status).toBe(401);
    const garbage = await POST(connectEvent({ headers: { "ce-signature": "sha256=zz,nonsense" } }));
    expect(garbage.status).toBe(401);
  });

  it("refuses another origin, another hub and any event but connect", async () => {
    expect(
      (await POST(connectEvent({ headers: { "webhook-request-origin": "evil.example" } }))).status,
    ).toBe(403);
    expect((await POST(connectEvent({ headers: { "ce-hub": "otherhub" } }))).status).toBe(400);
    expect(
      (
        await POST(
          connectEvent({
            headers: { "ce-type": "azure.webpubsub.user.message", "ce-eventName": "message" },
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("refuses everything when no Web PubSub is configured", async () => {
    configureLive({ db: fake.db, now: () => T0, upstream: null });
    expect((await POST(connectEvent())).status).toBe(503);
    const preflight = await OPTIONS(
      new Request("https://frejsi.example/api/pubsub", {
        method: "OPTIONS",
        headers: { "WebHook-Request-Origin": ORIGIN },
      }),
    );
    expect(preflight.status).toBe(403);
  });

  it("refuses the connection when the membership cannot be read", async () => {
    const db = fake.db;
    db.membership.findUnique = (() =>
      Promise.reject(new Error("database down"))) as unknown as typeof db.membership.findUnique;
    configureLive({ db, now: () => T0, upstream });
    const res = await POST(connectEvent());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("space-");
  });

  it("logs the space, the user and the count, never the token, the key or the signature", async () => {
    await POST(connectEvent({ userId: "viewer-1" }));
    await POST(connectEvent({ userId: "other-1" }));
    await POST(connectEvent({ headers: { "ce-signature": "sha256=00" } }));
    const all = logs.all();
    expect(all).toContain('"spaceId":"s1"');
    expect(all).toContain('"userId":"viewer-1"');
    expect(all).toContain('"count":1');
    expect(all).not.toContain("fictional-access-token");
    expect(all).not.toContain(ACCESS_KEY);
    expect(all).not.toContain("sha256");
    expect(all).not.toContain("conn-0001");
  });
});

describe("upstreamConfigFrom", () => {
  it("reads the key and the origin from the connection string and the hub from the settings", () => {
    expect(
      upstreamConfigFrom({
        WEB_PUBSUB_CONNECTION_STRING: `endpoint=https://${ORIGIN}/;accesskey=${ACCESS_KEY};version=1.0;`,
        WEB_PUBSUB_HUB: "Frejsi",
      }),
    ).toEqual({ accessKeys: [ACCESS_KEY], origin: ORIGIN, hub: "frejsi" });
    expect(upstreamConfigFrom({ WEB_PUBSUB_CONNECTION_STRING: CONNECTION_STRING })?.hub).toBe(
      "frejsi",
    );
  });

  it("is null without a connection string or without a key in it", () => {
    expect(upstreamConfigFrom({})).toBeNull();
    expect(
      upstreamConfigFrom({ WEB_PUBSUB_CONNECTION_STRING: `Endpoint=https://${ORIGIN};` }),
    ).toBeNull();
    expect(
      upstreamConfigFrom({ WEB_PUBSUB_CONNECTION_STRING: "not a connection string" }),
    ).toBeNull();
  });
});
