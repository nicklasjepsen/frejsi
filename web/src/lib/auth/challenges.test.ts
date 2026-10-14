// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CHALLENGE_TTL_MS, consumeChallenge, createChallenge } from "./challenges";
import { FakeAuthDb } from "./test-support";

const T0 = new Date("2026-10-15T08:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("challenges", () => {
  it("stores a challenge in AuthChallenge with a 5-minute expiry", async () => {
    const fake = new FakeAuthDb(() => T0);
    const { id } = await createChallenge(
      { kind: "register", challenge: "abc", inviteToken: "tok" },
      { db: fake.db, now: () => T0 },
    );
    expect(fake.rows("authChallenge")).toEqual([
      {
        id,
        challenge: "abc",
        kind: "register",
        inviteToken: "tok",
        userId: null,
        expiresAt: at(CHALLENGE_TTL_MS),
      },
    ]);
    expect(CHALLENGE_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("is consumed on first use: the second use of the same id fails (replay)", async () => {
    const fake = new FakeAuthDb(() => T0);
    const { id } = await createChallenge(
      { kind: "login", challenge: "abc" },
      { db: fake.db, now: () => T0 },
    );
    await expect(
      consumeChallenge(id, "login", { db: fake.db, now: () => at(1000) }),
    ).resolves.toEqual({ challenge: "abc", inviteToken: null, userId: null });
    await expect(
      consumeChallenge(id, "login", { db: fake.db, now: () => at(2000) }),
    ).rejects.toMatchObject({ status: 400, code: "validation" });
    expect(fake.rows("authChallenge")).toEqual([]);
  });

  it("rejects an expired challenge and removes it", async () => {
    const fake = new FakeAuthDb(() => T0);
    const { id } = await createChallenge(
      { kind: "login", challenge: "abc" },
      { db: fake.db, now: () => T0 },
    );
    await expect(
      consumeChallenge(id, "login", { db: fake.db, now: () => at(CHALLENGE_TTL_MS) }),
    ).rejects.toMatchObject({ status: 400, code: "validation" });
    expect(fake.rows("authChallenge")).toEqual([]);
  });

  it("rejects a challenge of the other kind and an unknown id", async () => {
    const fake = new FakeAuthDb(() => T0);
    const { id } = await createChallenge(
      { kind: "register", challenge: "abc", inviteToken: "tok" },
      { db: fake.db, now: () => T0 },
    );
    await expect(
      consumeChallenge(id, "login", { db: fake.db, now: () => at(1) }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      consumeChallenge("nope", "register", { db: fake.db, now: () => at(1) }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("sweeps expired rows when a new challenge is created", async () => {
    const fake = new FakeAuthDb(() => T0);
    await createChallenge({ kind: "login", challenge: "old" }, { db: fake.db, now: () => T0 });
    await createChallenge(
      { kind: "login", challenge: "new" },
      { db: fake.db, now: () => at(CHALLENGE_TTL_MS + 1) },
    );
    expect(fake.rows("authChallenge").map((r) => r.challenge)).toEqual(["new"]);
  });
});
