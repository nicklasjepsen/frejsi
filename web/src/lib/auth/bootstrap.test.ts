// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootstrapSpace, BootstrapRequest, tokenMatches } from "./bootstrap";
import { hashToken } from "./invites";
import { FakeAuthDb, FakeDbError, recordingSink } from "./test-support";

const T0 = new Date("2026-10-15T08:00:00.000Z");
const TOKEN = "example-bootstrap-token-0123456789";
const body = {
  spaceName: "Example space",
  ownerName: "Example Owner",
  timezone: "Europe/Copenhagen",
};

function world() {
  const fake = new FakeAuthDb(() => T0);
  const { sink, events } = recordingSink();
  return { fake, events, deps: { db: fake.db, sink, now: () => T0, expectedToken: TOKEN } };
}

beforeEach(() => {
  process.env.APP_ORIGIN = "https://frejsi.example";
});
afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe("tokenMatches", () => {
  it("compares in constant time and never matches a missing or empty token", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches("wrong", TOKEN)).toBe(false);
    expect(tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(null, TOKEN)).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
  });
});

describe("BootstrapRequest", () => {
  it("needs a space name, an owner name and a real IANA timezone", () => {
    expect(BootstrapRequest.safeParse(body).success).toBe(true);
    expect(BootstrapRequest.safeParse({ ...body, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(BootstrapRequest.safeParse({ ...body, spaceName: " " }).success).toBe(false);
    expect(BootstrapRequest.safeParse({ spaceName: "x", ownerName: "y" }).success).toBe(false);
  });
});

describe("bootstrapSpace", () => {
  it("creates the first space with the timezone, the owner and an owner invite, emits, and returns the URL", async () => {
    const w = world();
    const result = await bootstrapSpace({ token: TOKEN, body }, w.deps);

    expect(w.fake.rows("space")).toEqual([
      expect.objectContaining({
        id: result.spaceId,
        name: "Example space",
        timezone: "Europe/Copenhagen",
      }),
    ]);
    const owner = w.fake.rows("user")[0];
    expect(owner).toMatchObject({ name: "Example Owner" });
    expect(w.fake.rows("membership")).toEqual([
      expect.objectContaining({ userId: owner?.id, spaceId: result.spaceId, role: "owner" }),
    ]);
    const invite = w.fake.rows("invite")[0];
    expect(invite).toMatchObject({
      spaceId: result.spaceId,
      role: "owner",
      name: "Example Owner",
      forUserId: owner?.id,
      createdBy: owner?.id,
      usedAt: null,
    });
    expect(result.inviteUrl).toBe(`https://frejsi.example/invite/${invite?.token as string}`);
    expect(result.expiresAt).toEqual(new Date(T0.getTime() + 7 * 24 * 60 * 60 * 1000));
    expect(w.events).toEqual([
      {
        spaceId: result.spaceId,
        type: "member.joined",
        payload: { userId: owner?.id, role: "owner" },
      },
      {
        spaceId: result.spaceId,
        type: "invite.created",
        payload: {
          tokenHash: hashToken(invite?.token as string),
          role: "owner",
          name: "Example Owner",
          forUserId: owner?.id,
        },
      },
    ]);
  });

  it("answers 404 once any space exists, before looking at the token", async () => {
    const w = world();
    await bootstrapSpace({ token: TOKEN, body }, w.deps);
    await expect(bootstrapSpace({ token: TOKEN, body }, w.deps)).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
    await expect(bootstrapSpace({ token: "wrong", body }, w.deps)).rejects.toMatchObject({
      status: 404,
    });
    expect(w.fake.rows("space")).toHaveLength(1);
  });

  it("rechecks for a space inside a serializable transaction, so two bootstraps racing cannot both create one", async () => {
    const w = world();
    // A second bootstrap commits between this one's first check and its transaction.
    w.fake.onTransaction = () => {
      w.fake.rows("space").push({ id: "other", name: "Other", timezone: "Europe/Copenhagen" });
    };
    await expect(bootstrapSpace({ token: TOKEN, body }, w.deps)).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
    expect(w.fake.rows("space").map((s) => s.id)).toEqual(["other"]);
    expect(w.fake.rows("user")).toEqual([]);
    expect(w.fake.transactions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("is retried when SQL Server kills it as a deadlock victim (P2034), and then succeeds", async () => {
    const w = world();
    let victim = true;
    w.fake.onTransaction = () => {
      if (!victim) return;
      victim = false;
      throw new FakeDbError("P2034", "Transaction failed due to a write conflict or a deadlock.");
    };
    const result = await bootstrapSpace({ token: TOKEN, body }, w.deps);
    expect(w.fake.rows("space").map((s) => s.id)).toEqual([result.spaceId]);
    expect(w.fake.rows("user")).toHaveLength(1);
    expect(w.fake.transactions).toHaveLength(2);
    expect(w.events.map((e) => e.type)).toEqual(["member.joined", "invite.created"]);
  });

  it("answers 401 on a wrong or missing token and when no token is configured", async () => {
    const w = world();
    await expect(bootstrapSpace({ token: "wrong", body }, w.deps)).rejects.toMatchObject({
      status: 401,
      code: "forbidden",
    });
    await expect(bootstrapSpace({ token: null, body }, w.deps)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      bootstrapSpace({ token: TOKEN, body }, { ...w.deps, expectedToken: undefined }),
    ).rejects.toMatchObject({ status: 401 });
    expect(w.fake.rows("space")).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("answers 400 validation for a bad body and writes nothing", async () => {
    const w = world();
    await expect(
      bootstrapSpace({ token: TOKEN, body: { ...body, timezone: "nowhere" } }, w.deps),
    ).rejects.toMatchObject({ status: 400, code: "validation" });
    expect(w.fake.rows("space")).toEqual([]);
  });

  it("is one transaction: a failing invite write leaves no space, user or membership and no event", async () => {
    const w = world();
    w.fake.failNextWrite = "invite";
    await expect(bootstrapSpace({ token: TOKEN, body }, w.deps)).rejects.toThrow(/injected/);
    expect(w.fake.rows("space")).toEqual([]);
    expect(w.fake.rows("user")).toEqual([]);
    expect(w.fake.rows("membership")).toEqual([]);
    expect(w.events).toEqual([]);
  });
});
