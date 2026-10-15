// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureLive } from "@/lib/live/server";
import {
  captureLog,
  FakeLiveDb,
  liveRequest,
  RecordingIssuer,
  spaceContext,
} from "@/lib/live/test-support";

import { GET } from "./route";

const T0 = new Date("2026-10-15T13:13:00.000Z");

let fake: FakeLiveDb;
let issuer: RecordingIssuer;
let logs: ReturnType<typeof captureLog>;

beforeEach(() => {
  fake = new FakeLiveDb(() => T0);
  fake.addSpace("s1");
  fake.addMember("owner-1", "s1", "owner");
  fake.addMember("carer-1", "s1", "carer");
  fake.addMember("viewer-1", "s1", "viewer");
  fake.addSpace("s2");
  fake.addMember("other-1", "s2", "owner");
  issuer = new RecordingIssuer();
  configureLive({ db: fake.db, issuer, now: () => T0 });
  logs = captureLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  configureLive({});
});

const negotiate = (sessionId: string | null, spaceId = "s1") =>
  GET(liveRequest(spaceId, "negotiate", sessionId), spaceContext(spaceId));

describe("GET /api/spaces/:id/negotiate (plan §5, decision 3)", () => {
  it("bakes both groups into an owner's and a carer's token", async () => {
    const res = await negotiate("sess-owner-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "wss://example.webpubsub.azure.com/client/hubs/frejsi?access_token=example",
    });
    expect(issuer.requests[0]).toEqual({
      userId: "owner-1",
      groups: ["space-s1", "space-s1-glucose"],
    });

    expect((await negotiate("sess-carer-1")).status).toBe(200);
    expect(issuer.requests[1]).toEqual({
      userId: "carer-1",
      groups: ["space-s1", "space-s1-glucose"],
    });
  });

  it("never puts the glucose group into a viewer's token", async () => {
    const res = await negotiate("sess-viewer-1");
    expect(res.status).toBe(200);
    expect(issuer.requests).toEqual([{ userId: "viewer-1", groups: ["space-s1"] }]);
    for (const request of issuer.requests) {
      expect(request.groups.some((g) => g.includes("glucose"))).toBe(false);
    }
  });

  it("answers 404 for a member of another space and 403 without a session, issuing nothing", async () => {
    const stranger = await negotiate("sess-other-1");
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toMatchObject({ error: { code: "not-found" } });
    const anonymous = await negotiate(null);
    expect(anonymous.status).toBe(403);
    expect(issuer.requests).toEqual([]);
  });

  it("answers 503 when no Web PubSub is configured, so the client polls", async () => {
    issuer.url = null;
    const res = await negotiate("sess-owner-1");
    expect(res.status).toBe(503);
  });

  it("falls back to the environment's issuer once a test's issuer is gone, whatever ran first", async () => {
    vi.stubEnv("WEB_PUBSUB_CONNECTION_STRING", "");
    vi.stubEnv("WEB_PUBSUB_ENDPOINT", "");
    try {
      expect((await negotiate("sess-owner-1")).status).toBe(200);
      configureLive({ db: fake.db, now: () => T0 });
      // No Web PubSub in this environment: the Noop sink issues no token, so the client polls.
      expect((await negotiate("sess-owner-1")).status).toBe(503);
      expect(issuer.requests).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("logs the space and the user but never the socket URL", async () => {
    await negotiate("sess-owner-1");
    await negotiate("sess-other-1");
    const all = logs.all();
    expect(logs.lines.length).toBeGreaterThan(0);
    expect(all).toContain('"spaceId":"s1"');
    expect(all).toContain('"userId":"owner-1"');
    expect(all).not.toContain("access_token");
    expect(all).not.toContain("webpubsub");
    expect(all).not.toContain("Member owner-1");
  });
});
