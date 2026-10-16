// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  cookieStoreFor,
  request,
  seedSpace,
  T0,
  USERS,
  type Who,
} from "@/components/settings/route-test-support";
import { FakeAuthDb, recordingSink } from "@/lib/auth/test-support";

import { POST, DELETE, GET } from "./route";

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

const body = {
  spaceId: "s1",
  subscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/fictional-device",
    keys: { p256dh: "fictional-p256dh", auth: "fictional-auth" },
  },
};
function invoke(method: "POST" | "DELETE", as: Who = "owner", payload: unknown = body) {
  const req = request("/api/users/me/push-subscriptions", { method, as, body: payload });
  shared.holder.request = req;
  return (method === "POST" ? POST : DELETE)(req);
}
beforeEach(() => {
  vi.stubEnv("VAPID_PRIVATE_KEY", "fictional");
});
it("upserts on the user and endpoint, binds to the cookie session, and emits both writes", async () => {
  expect((await invoke("POST")).status).toBe(200);
  expect((await invoke("POST")).status).toBe(200);
  expect(fake.rows("pushSubscription")).toHaveLength(1);
  expect(fake.rows("pushSubscription")[0]).toMatchObject({
    userId: USERS.owner,
    spaceId: "s1",
    sessionId: "sess-owner",
    endpoint: body.subscription.endpoint,
    p256dh: "fictional-p256dh",
    auth: "fictional-auth",
  });
  expect(
    fake
      .rows("event")
      .map((e) => ({ type: e.type, payload: JSON.parse(e.payload as string) as unknown })),
  ).toEqual(
    [1, 2].map(() => ({
      type: "push.subscribed",
      payload: { spaceId: "s1", userId: USERS.owner },
    })),
  );
  expect((await invoke("DELETE")).status).toBe(200);
  expect(fake.rows("pushSubscription")).toEqual([]);
  expect(fake.rows("event").at(-1)).toMatchObject({ type: "push.unsubscribed" });
});
it("permits a carer but rejects viewer and non-member before a subscription write", async () => {
  expect((await invoke("POST", "viewer")).status).toBe(403);
  expect((await invoke("POST", "stranger")).status).toBe(404);
  expect(fake.rows("pushSubscription")).toEqual([]);
  expect((await invoke("POST", "carer")).status).toBe(200);
});
it.each(["POST", "DELETE"] as const)(
  "%s is unavailable without VAPID and does not expose the endpoint",
  async (method) => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const response = await invoke(method);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "push-not-configured" } });
    expect(fake.rows("pushSubscription")).toEqual([]);
  },
);
it("does not let another session remove a subscription; event failure rolls the write back", async () => {
  await invoke("POST", "owner");
  await invoke("DELETE", "carer");
  expect(fake.rows("pushSubscription")).toHaveLength(1);
  fake.failNextWrite = "event";
  expect((await invoke("POST", "carer")).status).toBe(500);
  expect(fake.rows("pushSubscription")).toHaveLength(1);
});

it("rejects arbitrary outbound destinations without writing", async () => {
  expect(
    (
      await invoke("POST", "owner", {
        ...body,
        subscription: { ...body.subscription, endpoint: "https://127.0.0.1/private" },
      })
    ).status,
  ).toBe(400);
  expect(fake.rows("pushSubscription")).toEqual([]);
});
it("reports the saved subscription only to its signed-in session", async () => {
  await invoke("POST");
  const req = request("/api/users/me/push-subscriptions?spaceId=s1", { as: "owner" });
  shared.holder.request = req;
  expect(await (await GET(req)).json()).toEqual({ subscribed: true });
  shared.holder.request = request("/api/users/me/push-subscriptions?spaceId=s1", { as: "carer" });
  expect(await (await GET(shared.holder.request)).json()).toEqual({ subscribed: false });
});
