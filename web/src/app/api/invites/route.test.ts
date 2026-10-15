// @vitest-environment node
import { InviteView } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInvite } from "@/lib/auth/invites";
import { FakeAuthDb } from "@/lib/auth/test-support";

import { GET } from "./[token]/route";

/** The route reads `prisma` from @frejsi/shared; it is swapped for the in-memory fake. */
const shared = vi.hoisted(() => {
  const holder: { db: Record<string, unknown> } = { db: {} };
  return {
    holder,
    prisma: new Proxy({}, { get: (_target, key: string) => holder.db[key] }),
  };
});
vi.mock("@frejsi/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: shared.prisma,
}));

const ORIGIN = "https://frejsi.example";
const T0 = new Date("2026-10-15T08:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

let fake: FakeAuthDb;
let logLines: string[];

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  process.env.APP_ORIGIN = ORIGIN;
  fake = new FakeAuthDb(() => T0);
  shared.holder.db = fake.db as unknown as Record<string, unknown>;
  fake.rows("space").push({ id: "s1", name: "Example space", timezone: "Europe/Copenhagen" });
  fake.rows("user").push({ id: "o1", name: "Example Owner" });
  fake.rows("user").push({ id: "u2", name: "Example Member" });
  fake.rows("membership").push({ userId: "o1", spaceId: "s1", role: "owner", createdAt: T0 });
  fake.rows("membership").push({ userId: "u2", spaceId: "s1", role: "carer", createdAt: T0 });
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

async function invite(name: string, role = "carer", forUserId?: string) {
  const { token } = await createInvite(
    {
      spaceId: "s1",
      role: role as "carer",
      name,
      createdBy: "o1",
      ...(forUserId ? { forUserId } : {}),
    },
    { db: fake.db, sink: { publish: () => Promise.resolve() }, now: () => T0 },
  );
  return token;
}

function get(token: string): Promise<Response> {
  return GET(new Request(`${ORIGIN}/api/invites/${token}`), {
    params: Promise.resolve({ token }),
  });
}

describe("GET /api/invites/[token] (task 6)", () => {
  it("returns the InviteView and nothing else: no space id, no token, no member list", async () => {
    const token = await invite("Example Invitee");
    const res = await get(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(InviteView.parse(body)).toEqual({
      name: "Example Invitee",
      spaceName: "Example space",
      role: "carer",
      inviterName: "Example Owner",
      daysLeft: 7,
      forExistingUser: false,
    });
    expect(Object.keys(body).sort()).toEqual(
      ["daysLeft", "forExistingUser", "inviterName", "name", "role", "spaceName"].sort(),
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain("s1");
    expect(text).not.toContain(token);
    expect(text).not.toContain("Example Member");
  });

  it("counts whole days left, rounding up, so a valid link never says 0 days", async () => {
    const token = await invite("Example Invitee");
    const row = fake.rows("invite").find((i) => i.token === token) ?? {};
    Object.assign(row, { expiresAt: new Date(T0.getTime() + 5.5 * DAY) });
    expect(((await (await get(token)).json()) as InviteView).daysLeft).toBe(6);
    Object.assign(row, { expiresAt: new Date(T0.getTime() + 3 * 60 * 60 * 1000) });
    expect(((await (await get(token)).json()) as InviteView).daysLeft).toBe(1);
  });

  it("marks an add-a-device link as for an existing user", async () => {
    const token = await invite("Example Member", "carer", "u2");
    const body = (await (await get(token)).json()) as InviteView;
    expect(body.forExistingUser).toBe(true);
    expect(body.role).toBe("carer");
  });

  it("answers 404 not-found for an unknown token", async () => {
    const res = await get("no-such-token");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not-found", message: expect.any(String) as string },
    });
  });

  it("answers 410 with the invite's state for a used, revoked or expired link, revealing nothing of the space", async () => {
    const used = await invite("Example Invitee");
    Object.assign(fake.rows("invite").find((i) => i.token === used) ?? {}, { usedAt: T0 });
    const revoked = await invite("Example Invitee");
    Object.assign(fake.rows("invite").find((i) => i.token === revoked) ?? {}, { revokedAt: T0 });
    const expired = await invite("Example Invitee");
    Object.assign(fake.rows("invite").find((i) => i.token === expired) ?? {}, {
      expiresAt: new Date(T0.getTime() - 1),
    });

    for (const [token, code] of [
      [used, "invite-used"],
      [revoked, "invite-revoked"],
      [expired, "invite-expired"],
    ] as const) {
      const res = await get(token);
      expect(res.status).toBe(410);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ error: { code } });
      expect(text).not.toContain("Example space");
      expect(text).not.toContain("Example Owner");
      expect(text).not.toContain("Example Invitee");
      expect(text).not.toContain("s1");
    }
  });

  it("logs the route and the code only: never the invitee's name or the token (plan §9)", async () => {
    const token = await invite("Example Invitee");
    await get(token);
    await get("no-such-token");
    expect(logLines.length).toBeGreaterThan(0);
    const output = logLines.join("");
    expect(output).not.toContain("Example Invitee");
    expect(output).not.toContain("Example Owner");
    expect(output).not.toContain("Example space");
    expect(output).not.toContain(token);
    expect(output).not.toContain("no-such-token");
    expect(output).toContain('"route":"invites/[token]"');
  });
});
