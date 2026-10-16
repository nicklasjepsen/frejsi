// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInvite } from "@/lib/auth/invites";
import { loadSession } from "@/lib/auth/session";
import {
  FakeAuthDb,
  recordingSink,
  VirtualAuthenticator,
  type RecordedEvent,
} from "@/lib/auth/test-support";

import { POST as loginOptions } from "./login/options/route";
import { POST as loginVerify } from "./login/verify/route";
import { POST as logoutRoute } from "./logout/route";
import { POST as registerOptions } from "./register/options/route";
import { POST as registerVerify } from "./register/verify/route";

/** The routes read `prisma` and the event sink from @frejsi/shared; both are swapped for fakes. */
const shared = vi.hoisted(() => {
  const holder: { db: Record<string, unknown>; sink: EventSink } = {
    db: {},
    sink: { publish: () => Promise.resolve() },
  };
  // core.ts caches the sink it builds once, so this one forwards to whatever the test set.
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

const ORIGIN = "https://frejsi.example";
const T0 = new Date("2026-10-15T08:00:00.000Z");

let fake: FakeAuthDb;
let events: RecordedEvent[];
let logLines: string[];
let authenticator: VirtualAuthenticator;

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  process.env.APP_ORIGIN = ORIGIN;
  fake = new FakeAuthDb(() => T0);
  const recorder = recordingSink();
  events = recorder.events;
  shared.holder.db = fake.db as unknown as Record<string, unknown>;
  shared.holder.sink = recorder.sink;
  fake.rows("space").push({ id: "s1", name: "Example space", timezone: "Europe/Copenhagen" });
  fake.rows("user").push({ id: "o1", name: "Example Owner" });
  fake.rows("membership").push({ userId: "o1", spaceId: "s1", role: "owner", createdAt: T0 });
  authenticator = new VirtualAuthenticator("frejsi.example", ORIGIN);
  logLines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    logLines.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.APP_ORIGIN;
});

function post(url: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function invite(name: string, role = "carer") {
  const { token } = await createInvite(
    { spaceId: "s1", role: role as "carer", name, createdBy: "o1" },
    { db: fake.db, sink: shared.sink, now: () => T0 },
  );
  events.length = 0;
  return token;
}

async function register(token: string, deviceName = "Example phone") {
  const started = await registerOptions(post("/api/auth/register/options", { inviteToken: token }));
  expect(started.status).toBe(200);
  const { challengeId, options } = (await started.json()) as {
    challengeId: string;
    options: Parameters<VirtualAuthenticator["register"]>[0];
  };
  const response = authenticator.register(options);
  return registerVerify(post("/api/auth/register/verify", { challengeId, response, deviceName }));
}

const COOKIE =
  /^frejsi_session=([A-Za-z0-9_-]{43}); HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=7776000$/;

describe("POST /api/auth/register/options and /verify", () => {
  it("issue options with residentKey required and userVerification preferred", async () => {
    const token = await invite("Example Carer");
    const res = await registerOptions(post("/api/auth/register/options", { inviteToken: token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeId: string; options: Record<string, unknown> };
    expect(body.challengeId).toEqual(expect.any(String));
    expect(body.options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "preferred",
    });
    expect(body.options.rp).toMatchObject({ id: "frejsi.example" });
  });

  it("register the user, membership, passkey and session, set the cookie and emit member.joined", async () => {
    const token = await invite("Example Carer");
    const res = await register(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; spaceId: string; role: string };
    expect(body).toMatchObject({ spaceId: "s1", role: "carer" });

    const cookie = res.headers.getSetCookie()[0] ?? "";
    expect(cookie).toMatch(COOKIE);
    // A new user follows the device; any theme left by an earlier user on this device goes.
    expect(res.headers.getSetCookie()[1]).toBe("frejsi_theme=; Path=/; SameSite=Lax; Max-Age=0");
    const sessionId = COOKIE.exec(cookie)?.[1] ?? "";
    await expect(loadSession(sessionId, { db: fake.db })).resolves.toMatchObject({
      userId: body.userId,
      name: "Example Carer",
      memberships: [{ spaceId: "s1", role: "carer" }],
    });
    expect(fake.rows("passkey")).toHaveLength(1);
    expect(fake.rows("invite")[0]).toMatchObject({ usedAt: T0 });
    expect(events).toEqual([
      { spaceId: "s1", type: "member.joined", payload: { userId: body.userId, role: "carer" } },
    ]);
  });

  it("answer invite-used, invite-expired and invite-revoked as ApiError bodies", async () => {
    const token = await invite("Example Carer");
    await register(token);
    const used = await registerOptions(post("/api/auth/register/options", { inviteToken: token }));
    expect(used.status).toBe(410);
    expect(await used.json()).toMatchObject({ error: { code: "invite-used" } });

    const expiredToken = await invite("Example Viewer", "viewer");
    Object.assign(fake.rows("invite").find((i) => i.token === expiredToken) ?? {}, {
      expiresAt: new Date(T0.getTime() - 1),
    });
    const expired = await registerOptions(
      post("/api/auth/register/options", { inviteToken: expiredToken }),
    );
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: { code: "invite-expired" } });

    const revokedToken = await invite("Example Viewer", "viewer");
    Object.assign(fake.rows("invite").find((i) => i.token === revokedToken) ?? {}, {
      revokedAt: T0,
    });
    const revoked = await registerOptions(
      post("/api/auth/register/options", { inviteToken: revokedToken }),
    );
    expect(revoked.status).toBe(410);
    expect(await revoked.json()).toMatchObject({ error: { code: "invite-revoked" } });
    expect(fake.rows("user")).toHaveLength(2);
  });

  it("reject a request whose Origin differs or is missing, before any write", async () => {
    const token = await invite("Example Carer");
    const other = await registerOptions(
      post(
        "/api/auth/register/options",
        { inviteToken: token },
        { origin: "https://evil.example" },
      ),
    );
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: "forbidden" } });
    const none = await registerOptions(
      new Request(`${ORIGIN}/api/auth/register/options`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token }),
      }),
    );
    expect(none.status).toBe(403);
    expect(fake.rows("authChallenge")).toEqual([]);
  });

  it("answer 400 validation for a malformed body and never a stack trace", async () => {
    const bad = await registerVerify(post("/api/auth/register/verify", { challengeId: "x" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "validation" } });
    const notJson = await registerOptions(
      new Request(`${ORIGIN}/api/auth/register/options`, {
        method: "POST",
        headers: { origin: ORIGIN },
        body: "not json",
      }),
    );
    expect(notJson.status).toBe(400);
  });

  it("log ids only: no token, name or device name reaches a log line", async () => {
    const token = await invite("Example Carer");
    const res = await register(token, "Example phone");
    expect(res.status).toBe(200);
    const { userId } = (await res.json()) as { userId: string };
    expect(logLines.length).toBeGreaterThan(0);
    const all = logLines.join("\n");
    expect(all).not.toContain(token);
    expect(all).not.toContain("Example Carer");
    expect(all).not.toContain("Example phone");
    expect(all).toContain(`"userId":"${userId}"`);
    expect(all).toContain('"spaceId":"s1"');
  });
});

describe("POST /api/auth/login/options and /verify", () => {
  it("sign a registered device in with a discoverable credential and set the cookie", async () => {
    const token = await invite("Example Carer");
    const registered = (await (await register(token)).json()) as { userId: string };
    // Chosen on another device earlier; this device gets it with the session.
    const stored = fake.rows("user").find((u) => u.id === registered.userId);
    if (stored) stored.theme = "dark";

    const started = await loginOptions(post("/api/auth/login/options"));
    expect(started.status).toBe(200);
    const { challengeId, options } = (await started.json()) as {
      challengeId: string;
      options: Parameters<VirtualAuthenticator["authenticate"]>[0] & {
        allowCredentials?: unknown[];
      };
    };
    expect(options.allowCredentials ?? []).toEqual([]);

    const response = authenticator.authenticate(options);
    const res = await loginVerify(post("/api/auth/login/verify", { challengeId, response }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: registered.userId });
    const cookie = res.headers.getSetCookie()[0] ?? "";
    expect(cookie).toMatch(COOKIE);
    expect(res.headers.getSetCookie()[1]).toBe(
      "frejsi_theme=dark; Path=/; SameSite=Lax; Max-Age=31536000",
    );
    const sessionId = COOKIE.exec(cookie)?.[1] ?? "";
    await expect(loadSession(sessionId, { db: fake.db })).resolves.toMatchObject({
      userId: registered.userId,
    });
    expect(fake.rows("passkey")[0]).toMatchObject({ counter: 1, lastUsedAt: T0 });
    expect(fake.rows("user").find((u) => u.id === registered.userId)).toMatchObject({
      lastSeen: T0,
    });
    // The lastSeen touch is a member write People shows: member.updated follows the registration's event.
    expect(events.map((e) => e.type)).toEqual(["member.joined", "member.updated"]);
    expect(logLines.join("\n")).not.toContain("Example Carer");
  });

  it("refuse a replayed counter with 403 forbidden and open no session", async () => {
    const token = await invite("Example Carer");
    await register(token);
    const first = (await (await loginOptions(post("/api/auth/login/options"))).json()) as {
      challengeId: string;
      options: Parameters<VirtualAuthenticator["authenticate"]>[0];
    };
    await loginVerify(
      post("/api/auth/login/verify", {
        challengeId: first.challengeId,
        response: authenticator.authenticate(first.options, { counter: 3 }),
      }),
    );
    const second = (await (await loginOptions(post("/api/auth/login/options"))).json()) as {
      challengeId: string;
      options: Parameters<VirtualAuthenticator["authenticate"]>[0];
    };
    const res = await loginVerify(
      post("/api/auth/login/verify", {
        challengeId: second.challengeId,
        response: authenticator.authenticate(second.options, { counter: 3 }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(fake.rows("session")).toHaveLength(2);
  });
});

describe("POST /api/auth/logout", () => {
  it("deletes the current session and clears the cookie", async () => {
    const token = await invite("Example Carer");
    const cookie = (await register(token)).headers.getSetCookie()[0] ?? "";
    const sessionId = COOKIE.exec(cookie)?.[1] ?? "";
    expect(fake.rows("session").map((s) => s.id)).toEqual([sessionId]);

    const res = await logoutRoute(
      post("/api/auth/logout", undefined, { cookie: `other=1; frejsi_session=${sessionId}` }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toEqual([
      "frejsi_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      "frejsi_theme=; Path=/; SameSite=Lax; Max-Age=0",
    ]);
    expect(fake.rows("session")).toEqual([]);
    await expect(loadSession(sessionId, { db: fake.db })).resolves.toBeNull();

    const again = await logoutRoute(post("/api/auth/logout"));
    expect(again.status).toBe(204);
  });
});
