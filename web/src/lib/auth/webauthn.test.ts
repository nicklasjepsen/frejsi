// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHALLENGE_TTL_MS } from "./challenges";
import { appOrigin, rpId } from "./core";
import { createInvite } from "./invites";
import { loadSession, SESSION_MAX_AGE_SECONDS } from "./session";
import { FakeAuthDb, recordingEmit, VirtualAuthenticator } from "./test-support";
import {
  assertOrigin,
  finishLogin,
  finishRegistration,
  logout,
  removePasskey,
  startLogin,
  startRegistration,
} from "./webauthn";

const ORIGIN = "https://frejsi.example";
const T0 = new Date("2026-10-15T08:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

function caught(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

function world() {
  const fake = new FakeAuthDb(() => T0);
  fake.rows("space").push({ id: "s1", name: "Example space", timezone: "Europe/Copenhagen" });
  fake.rows("user").push({ id: "o1", name: "Example Owner" });
  fake.rows("membership").push({ userId: "o1", spaceId: "s1", role: "owner", createdAt: T0 });
  const { emit, events } = recordingEmit();
  const deps = { db: fake.db, emit, now: () => T0 };
  const authenticator = new VirtualAuthenticator(rpId(), ORIGIN);
  return { fake, emit, events, deps, authenticator };
}

async function carerInvite(w: ReturnType<typeof world>, forUserId?: string) {
  const { token } = await createInvite(
    {
      spaceId: "s1",
      role: "carer",
      name: "Example Carer",
      createdBy: "o1",
      ...(forUserId ? { forUserId } : {}),
    },
    w.deps,
  );
  w.events.length = 0;
  return token;
}

/** Registers a new carer from an invite and returns what the route would get. */
async function registerCarer(w: ReturnType<typeof world>, deviceName = "Example phone") {
  const token = await carerInvite(w);
  const { challengeId, options } = await startRegistration(token, w.deps);
  const response = w.authenticator.register(options);
  return finishRegistration({ challengeId, response, deviceName }, w.deps);
}

beforeEach(() => {
  process.env.APP_ORIGIN = ORIGIN;
});
afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe("APP_ORIGIN", () => {
  it("is required, and the rpID is its host", () => {
    expect(appOrigin()).toBe(ORIGIN);
    expect(rpId()).toBe("frejsi.example");
    delete process.env.APP_ORIGIN;
    expect(() => appOrigin()).toThrow(/APP_ORIGIN/);
    expect(() => rpId()).toThrow(/APP_ORIGIN/);
  });

  it("rejects a request whose Origin differs, and one without an Origin", () => {
    expect(() => {
      assertOrigin(ORIGIN);
    }).not.toThrow();
    expect(
      caught(() => {
        assertOrigin("https://evil.example");
      }),
    ).toMatchObject({ status: 403, code: "forbidden" });
    expect(
      caught(() => {
        assertOrigin(null);
      }),
    ).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("registration", () => {
  it("issues options with residentKey required, userVerification preferred and the rpID", async () => {
    const w = world();
    const token = await carerInvite(w);
    const { challengeId, options } = await startRegistration(token, w.deps);
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "preferred",
    });
    expect(options.rp.id).toBe("frejsi.example");
    expect(options.user.name).toBe("Example Carer");
    expect(w.fake.rows("authChallenge")).toEqual([
      expect.objectContaining({
        id: challengeId,
        kind: "register",
        challenge: options.challenge,
        inviteToken: token,
        expiresAt: at(CHALLENGE_TTL_MS),
      }),
    ]);
  });

  it("creates user, passkey, membership with the invite's role and session, marks the invite used and emits member.joined", async () => {
    const w = world();
    const result = await registerCarer(w);

    const user = w.fake.rows("user").find((u) => u.id === result.userId);
    expect(user).toMatchObject({ name: "Example Carer" });
    expect(w.fake.rows("membership")).toContainEqual(
      expect.objectContaining({ userId: result.userId, spaceId: "s1", role: "carer" }),
    );
    const passkey = w.fake.rows("passkey")[0];
    expect(passkey).toMatchObject({
      userId: result.userId,
      counter: 0,
      deviceName: "Example phone",
      transports: "internal",
    });
    expect(passkey?.publicKey).toBeInstanceOf(Uint8Array);
    expect(w.fake.rows("session")).toEqual([
      expect.objectContaining({
        id: result.sessionId,
        userId: result.userId,
        passkeyId: passkey?.id,
        expiresAt: at(SESSION_MAX_AGE_SECONDS * 1000),
      }),
    ]);
    expect(w.fake.rows("invite")[0]).toMatchObject({ usedAt: T0 });
    expect(w.fake.rows("authChallenge")).toEqual([]);
    expect(result).toMatchObject({ spaceId: "s1", role: "carer" });
    expect(w.events).toEqual([
      { spaceId: "s1", type: "member.joined", payload: { userId: result.userId, role: "carer" } },
    ]);
  });

  it("is one transaction: a failure on the session leaves no user, passkey, membership or used invite, and no event", async () => {
    const w = world();
    const token = await carerInvite(w);
    const { challengeId, options } = await startRegistration(token, w.deps);
    const response = w.authenticator.register(options);
    w.fake.failNextWrite = "session";
    await expect(finishRegistration({ challengeId, response }, w.deps)).rejects.toThrow(
      /injected failure/,
    );
    expect(w.fake.rows("user").map((u) => u.id)).toEqual(["o1"]);
    expect(w.fake.rows("passkey")).toEqual([]);
    expect(w.fake.rows("membership")).toHaveLength(1);
    expect(w.fake.rows("invite")[0]).toMatchObject({ usedAt: null });
    expect(w.events).toEqual([]);
  });

  it("the session it creates is what loadSession() returns", async () => {
    const w = world();
    const result = await registerCarer(w);
    await expect(loadSession(result.sessionId, { db: w.fake.db, emit: w.emit })).resolves.toEqual({
      userId: result.userId,
      name: "Example Carer",
      simpleMode: false,
      accent: "olive",
      locale: "da",
      memberships: [{ spaceId: "s1", role: "carer" }],
    });
  });

  it("rejects a second use of the same token with invite-used", async () => {
    const w = world();
    const token = await carerInvite(w);
    const first = await startRegistration(token, w.deps);
    const second = await startRegistration(token, w.deps);
    await finishRegistration(
      { challengeId: first.challengeId, response: w.authenticator.register(first.options) },
      w.deps,
    );
    await expect(
      finishRegistration(
        { challengeId: second.challengeId, response: w.authenticator.register(second.options) },
        w.deps,
      ),
    ).rejects.toMatchObject({ code: "invite-used" });
    expect(w.fake.rows("user")).toHaveLength(2);
  });

  it("rejects a token older than 7 days with invite-expired and a revoked one with invite-revoked", async () => {
    const w = world();
    const token = await carerInvite(w);
    const later = { ...w.deps, now: () => at(7 * DAY) };
    await expect(startRegistration(token, later)).rejects.toMatchObject({ code: "invite-expired" });

    const { challengeId, options } = await startRegistration(token, w.deps);
    const response = w.authenticator.register(options);
    Object.assign(w.fake.rows("invite")[0] ?? {}, { revokedAt: T0 });
    await expect(finishRegistration({ challengeId, response }, w.deps)).rejects.toMatchObject({
      code: "invite-revoked",
    });
    expect(w.fake.rows("passkey")).toEqual([]);
  });

  it("consumes the challenge: a replay of the same response fails", async () => {
    const w = world();
    const token = await carerInvite(w);
    const { challengeId, options } = await startRegistration(token, w.deps);
    const response = w.authenticator.register(options);
    await finishRegistration({ challengeId, response }, w.deps);
    await expect(finishRegistration({ challengeId, response }, w.deps)).rejects.toMatchObject({
      status: 400,
      code: "validation",
    });
  });

  it("rejects a response whose origin differs from APP_ORIGIN", async () => {
    const w = world();
    const token = await carerInvite(w);
    const { challengeId, options } = await startRegistration(token, w.deps);
    const response = w.authenticator.register(options, { origin: "https://evil.example" });
    await expect(finishRegistration({ challengeId, response }, w.deps)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(w.fake.rows("passkey")).toEqual([]);
    expect(w.fake.rows("invite")[0]).toMatchObject({ usedAt: null });
  });

  it("with forUserId adds a passkey to the existing user, no new user or membership, and emits device.added", async () => {
    const w = world();
    const token = await carerInvite(w, "o1");
    const { challengeId, options } = await startRegistration(token, w.deps);
    expect(options.user.name).toBe("Example Owner");
    const response = w.authenticator.register(options, {});
    const result = await finishRegistration(
      { challengeId, response, deviceName: "Example tablet" },
      w.deps,
    );
    expect(result).toMatchObject({ userId: "o1", spaceId: "s1", role: "owner" });
    expect(w.fake.rows("user")).toHaveLength(1);
    expect(w.fake.rows("membership")).toHaveLength(1);
    const passkey = w.fake.rows("passkey")[0];
    expect(passkey).toMatchObject({ userId: "o1", deviceName: "Example tablet" });
    expect(w.fake.rows("invite")[0]).toMatchObject({ usedAt: T0 });
    expect(w.events).toEqual([
      { spaceId: "s1", type: "device.added", payload: { userId: "o1", passkeyId: passkey?.id } },
    ]);
  });

  it("an add-a-device link for someone no longer in the space fails before the passkey prompt", async () => {
    const w = world();
    const carer = await registerCarer(w);
    const token = await carerInvite(w, carer.userId);
    // The owner removes the carer after creating the link.
    w.fake.tables.membership = w.fake
      .rows("membership")
      .filter((m) => m.userId !== carer.userId);
    await expect(startRegistration(token, w.deps)).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
    expect(w.fake.rows("authChallenge")).toEqual([]);
  });

  it("names the cause when the link is revoked while the person is at the passkey prompt", async () => {
    const w = world();
    const token = await carerInvite(w);
    const { challengeId, options } = await startRegistration(token, w.deps);
    const response = w.authenticator.register(options);
    // The owner presses "send again" (revoke) between the ceremony's start and its claim.
    w.fake.beforeWrite = (table) => {
      if (table !== "invite") return;
      const invite = w.fake.rows("invite").find((i) => i.token === token);
      if (invite && !invite.revokedAt) invite.revokedAt = T0;
    };
    await expect(finishRegistration({ challengeId, response }, w.deps)).rejects.toMatchObject({
      status: 410,
      code: "invite-revoked",
    });
    expect(w.fake.rows("user").map((u) => u.id)).toEqual(["o1"]);
    expect(w.fake.rows("passkey")).toEqual([]);
    expect(w.fake.rows("invite")[0]).toMatchObject({ usedAt: null });
    expect(w.events).toEqual([]);
  });

  it("excludes the user's existing passkeys from an add-a-device registration", async () => {
    const w = world();
    const first = await registerCarer(w);
    const token = await carerInvite(w, first.userId);
    const { options } = await startRegistration(token, w.deps);
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual(
      w.fake.rows("passkey").map((p) => p.credentialId),
    );
  });
});

describe("login", () => {
  it("issues discoverable-credential options (no allowCredentials) with the rpID", async () => {
    const w = world();
    const { challengeId, options } = await startLogin(w.deps);
    expect(options.rpId).toBe("frejsi.example");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("preferred");
    expect(w.fake.rows("authChallenge")).toEqual([
      expect.objectContaining({ id: challengeId, kind: "login", challenge: options.challenge }),
    ]);
  });

  it("verifies the assertion, updates counter, lastUsedAt and lastSeen, and opens a session loadSession() returns", async () => {
    const w = world();
    const registered = await registerCarer(w);
    const later = { ...w.deps, now: () => at(DAY) };
    const { challengeId, options } = await startLogin(later);
    const response = w.authenticator.authenticate(options);
    const result = await finishLogin({ challengeId, response }, later);

    expect(result.userId).toBe(registered.userId);
    expect(result.sessionId).not.toBe(registered.sessionId);
    expect(result.expiresAt).toEqual(at(DAY + SESSION_MAX_AGE_SECONDS * 1000));
    expect(w.fake.rows("passkey")[0]).toMatchObject({ counter: 1, lastUsedAt: at(DAY) });
    expect(w.fake.rows("user").find((u) => u.id === registered.userId)).toMatchObject({
      lastSeen: at(DAY),
    });
    expect(w.fake.rows("session")).toHaveLength(2);
    await expect(
      loadSession(result.sessionId, { db: w.fake.db, emit: w.emit, now: () => at(DAY) }),
    ).resolves.toMatchObject({
      userId: registered.userId,
      memberships: [{ spaceId: "s1", role: "carer" }],
    });
    // People shows lastSeen, so the touch is a member write: member.updated to each of the
    // user's spaces, after the commit (loadSession() does the same for its hourly touch).
    expect(w.events.slice(1)).toEqual([
      { spaceId: "s1", type: "member.updated", payload: { userId: registered.userId } },
    ]);
  });

  it("enforces the signature counter: a cloned authenticator replaying an old counter is refused", async () => {
    const w = world();
    await registerCarer(w);
    const first = await startLogin(w.deps);
    await finishLogin(
      {
        challengeId: first.challengeId,
        response: w.authenticator.authenticate(first.options, { counter: 5 }),
      },
      w.deps,
    );
    expect(w.fake.rows("passkey")[0]).toMatchObject({ counter: 5 });

    const second = await startLogin(w.deps);
    await expect(
      finishLogin(
        {
          challengeId: second.challengeId,
          response: w.authenticator.authenticate(second.options, { counter: 5 }),
        },
        w.deps,
      ),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(w.fake.rows("passkey")[0]).toMatchObject({ counter: 5 });
    expect(w.fake.rows("session")).toHaveLength(2);
  });

  it("refuses a login that raced another on the same passkey: the counter write is conditional and no session opens", async () => {
    const w = world();
    await registerCarer(w);
    const { challengeId, options } = await startLogin(w.deps);
    const response = w.authenticator.authenticate(options, { counter: 6 });
    // Between this login's read of the passkey and its write, another login committed counter 7.
    w.fake.beforeWrite = (table) => {
      if (table === "passkey") Object.assign(w.fake.rows("passkey")[0] ?? {}, { counter: 7 });
    };
    await expect(finishLogin({ challengeId, response }, w.deps)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    // The stale counter never lands (the fake's rollback restores its own snapshot; a real
    // database keeps the other login's 7), and this login opened no session.
    expect(w.fake.rows("passkey")[0]?.counter).not.toBe(6);
    expect(w.fake.rows("session")).toHaveLength(1);
  });

  it("refuses an unknown credential, a wrong origin and a consumed challenge", async () => {
    const w = world();
    await registerCarer(w);
    const stranger = new VirtualAuthenticator(rpId(), ORIGIN);
    const { challengeId, options } = await startLogin(w.deps);
    stranger.register({
      ...options,
      rp: { id: rpId(), name: "x" },
      user: { id: "x", name: "x", displayName: "x" },
      pubKeyCredParams: [],
    });
    await expect(
      finishLogin({ challengeId, response: stranger.authenticate(options) }, w.deps),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });

    const wrongOrigin = await startLogin(w.deps);
    await expect(
      finishLogin(
        {
          challengeId: wrongOrigin.challengeId,
          response: w.authenticator.authenticate(wrongOrigin.options, {
            origin: "https://evil.example",
          }),
        },
        w.deps,
      ),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });

    const good = await startLogin(w.deps);
    const response = w.authenticator.authenticate(good.options);
    await finishLogin({ challengeId: good.challengeId, response }, w.deps);
    await expect(
      finishLogin({ challengeId: good.challengeId, response }, w.deps),
    ).rejects.toMatchObject({ status: 400, code: "validation" });
  });
});

describe("removePasskey and logout", () => {
  it("deleting a passkey deletes its sessions and emits device.removed; the device is then unauthenticated", async () => {
    const w = world();
    const registered = await registerCarer(w);
    const passkeyId = w.fake.rows("passkey")[0]?.id as string;
    w.events.length = 0;

    await removePasskey(passkeyId, w.deps);

    expect(w.fake.rows("passkey")).toEqual([]);
    expect(w.fake.rows("session")).toEqual([]);
    await expect(
      loadSession(registered.sessionId, { db: w.fake.db, emit: w.emit }),
    ).resolves.toBeNull();
    expect(w.events).toEqual([
      { spaceId: "s1", type: "device.removed", payload: { userId: registered.userId, passkeyId } },
    ]);
    await expect(removePasskey(passkeyId, w.deps)).rejects.toMatchObject({ code: "not-found" });
  });

  it("logout deletes the current session only", async () => {
    const w = world();
    const registered = await registerCarer(w);
    const { challengeId, options } = await startLogin(w.deps);
    const other = await finishLogin(
      { challengeId, response: w.authenticator.authenticate(options) },
      w.deps,
    );
    await logout(registered.sessionId, w.deps);
    expect(w.fake.rows("session").map((s) => s.id)).toEqual([other.sessionId]);
    await expect(
      loadSession(registered.sessionId, { db: w.fake.db, emit: w.emit }),
    ).resolves.toBeNull();
    await expect(logout("unknown", w.deps)).resolves.toBeUndefined();
  });
});
