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
import { FakeAuthDb, recordingSink } from "@/lib/auth/test-support";

import { GET } from "./route";

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

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  fake = new FakeAuthDb(() => T0);
  seedSpace(fake);
  const recorder = recordingSink();

  shared.holder.db = fake.db as unknown as Record<string, unknown>;
  shared.holder.sink = recorder.sink;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function get(as: Who | null, spaceId = "s1") {
  const req = request(`/api/spaces/${spaceId}/ai`, { as });
  shared.holder.request = req;
  return GET(req, params({ spaceId }));
}

describe("GET ai", () => {
  beforeEach(() => {
    const space = fake.rows("space")[0];
    if (!space) throw new Error("Missing fixture");
    space.aiEnabled = false;
    shared.holder.db.aiCall = { count: () => Promise.resolve(7) };
    vi.stubEnv("FAKE_AI_PROVIDER", "1");
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-test");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-test");
    vi.stubEnv("VAPID_SUBJECT", "https://frejsi.example");
  });
  it.each(["owner", "carer"] as const)(
    "returns safe runtime usage to %s, including simple view",
    async (who) => {
      const user = fake.rows("user").find((u) => u.id === USERS[who]);
      if (!user) throw new Error("Missing fixture");
      user.simpleMode = true;
      const response = await get(who);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({
        enabled: false,
        providers: ["anthropic", "azure-openai", "ollama"].map((id) => ({
          id,
          configured: true,
          capabilities: { complete: true, vision: true, embed: true },
        })),
        callsToday: 7,
        dailyCap: 50,
        embedCallsToday: 7,
        embedDailyCap: 500,
        pushPublicKey: "public-test",
      });
      expect(Object.keys(body).sort()).toEqual([
        "callsToday",
        "dailyCap",
        "embedCallsToday",
        "embedDailyCap",
        "enabled",
        "providers",
        "pushPublicKey",
      ]);
      expect(JSON.stringify(body)).not.toMatch(/private-test|frejsi.example|mmol|glucose|hostname/);
    },
  );
  it("rejects viewer and non-member before any usage repository read", async () => {
    const count = vi.fn(() => Promise.resolve(0));
    shared.holder.db.aiCall = { count };
    const read = vi.spyOn(fake.db.space, "findUnique");
    expect((await get("viewer")).status).toBe(403);
    expect((await get("stranger")).status).toBe(404);
    expect(count).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});
