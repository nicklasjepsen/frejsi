// The world the People route tests run in: the in-memory auth db seeded with one space and a
// member of every role, each with a session, a recording event sink, and the captured log.
// Imported by *.test.ts only. The test file itself mocks `@frejsi/shared` and `next/headers`
// (vi.mock is hoisted per file) and hands the holders to `createWorld`.
import type { EventSink } from "@frejsi/shared";
import { vi } from "vitest";

import { FakeAuthDb, recordingSink, type RecordedEvent } from "@/lib/auth/test-support";

export const ORIGIN = "https://frejsi.example";
export const T0 = new Date("2026-10-15T08:00:00.000Z");
export const days = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

/** What the test file's hoisted mocks expose for the world to fill. */
export interface Holders {
  shared: { db: Record<string, unknown>; sink: EventSink };
  cookies: Map<string, string>;
}

/** Fictional members of the seeded space `s1` (names from the design's fixtures are not used). */
export const USERS = {
  owner: { id: "u-owner", name: "Example Owner", session: "sess-owner" },
  secondOwner: { id: "u-owner-2", name: "Second Owner", session: "sess-owner-2" },
  carer: { id: "u-carer", name: "Example Carer", session: "sess-carer" },
  viewer: { id: "u-viewer", name: "Example Viewer", session: "sess-viewer" },
  /** A member of another space only. */
  outsider: { id: "u-outsider", name: "Example Outsider", session: "sess-outsider" },
} as const;

export const PASSKEYS = {
  ownerPhone: "pk-owner-phone",
  ownerLaptop: "pk-owner-laptop",
  carerTablet: "pk-carer-tablet",
  outsiderPhone: "pk-outsider-phone",
} as const;

export const DEVICE_NAMES = {
  ownerPhone: "Example phone",
  carerTablet: "Example tablet",
} as const;

export const PENDING_TOKEN = "pending-token-0123456789abcdefghijklmnopqrstuv";
export const PENDING_NAME = "Example Invitee";

export interface World {
  fake: FakeAuthDb;
  events: RecordedEvent[];
  logLines: string[];
  /** Signs the next requests in as this user (sets the session cookie the routes read). */
  as(user: keyof typeof USERS | null): void;
  /** A request to the app's own origin with a JSON body when given. */
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request;
  /** Every log line so far, joined. */
  log(): string;
  reset(): void;
}

function passkey(id: string, userId: string, deviceName: string | null, createdAt: Date) {
  return {
    id,
    userId,
    credentialId: `cred-${id}`,
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 1,
    transports: "internal",
    deviceName,
    createdAt,
    lastUsedAt: createdAt,
  };
}

function session(id: string, userId: string) {
  return { id, userId, passkeyId: null, createdAt: T0, expiresAt: days(90), lastSeenAt: T0 };
}

export function createWorld(holders: Holders): World {
  const fake = new FakeAuthDb(() => T0);
  const recorder = recordingSink();
  holders.shared.db = fake.db as unknown as Record<string, unknown>;
  holders.shared.sink = recorder.sink;
  holders.cookies.clear();

  fake
    .rows("space")
    .push(
      { id: "s1", name: "Example space", timezone: "Europe/Copenhagen" },
      { id: "s2", name: "Other space", timezone: "Europe/Copenhagen" },
    );
  for (const user of Object.values(USERS)) {
    fake.rows("user").push({
      id: user.id,
      name: user.name,
      simpleMode: false,
      accent: "olive",
      theme: "system",
      locale: "da",
      lastSeen: T0,
    });
    fake.rows("session").push(session(user.session, user.id));
  }
  fake
    .rows("membership")
    .push(
      { userId: USERS.owner.id, spaceId: "s1", role: "owner", createdAt: days(-10) },
      { userId: USERS.secondOwner.id, spaceId: "s1", role: "owner", createdAt: days(-9) },
      { userId: USERS.carer.id, spaceId: "s1", role: "carer", createdAt: days(-8) },
      { userId: USERS.viewer.id, spaceId: "s1", role: "viewer", createdAt: days(-7) },
      { userId: USERS.outsider.id, spaceId: "s2", role: "owner", createdAt: days(-10) },
    );
  fake
    .rows("passkey")
    .push(
      passkey(PASSKEYS.ownerPhone, USERS.owner.id, DEVICE_NAMES.ownerPhone, days(-10)),
      passkey(PASSKEYS.ownerLaptop, USERS.owner.id, null, days(-5)),
      passkey(PASSKEYS.carerTablet, USERS.carer.id, DEVICE_NAMES.carerTablet, days(-8)),
      passkey(PASSKEYS.outsiderPhone, USERS.outsider.id, "Outsider phone", days(-10)),
    );
  fake.rows("invite").push({
    token: PENDING_TOKEN,
    spaceId: "s1",
    role: "carer",
    name: PENDING_NAME,
    forUserId: null,
    createdBy: USERS.owner.id,
    createdAt: days(-1),
    expiresAt: days(6),
    usedAt: null,
    revokedAt: null,
  });

  const logLines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    logLines.push(String(chunk));
    return true;
  });

  return {
    fake,
    events: recorder.events,
    logLines,
    as(user) {
      holders.cookies.clear();
      if (user) holders.cookies.set("frejsi_session", USERS[user].session);
    },
    request(method, path, body, headers = {}) {
      return new Request(`${ORIGIN}${path}`, {
        method,
        headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
    log: () => logLines.join("\n"),
    reset() {
      vi.restoreAllMocks();
    },
  };
}

/** Everything a log line must never carry (plan §9): names, device names, the invite token. */
export function assertNoPii(all: string): void {
  const forbidden = [
    ...Object.values(USERS).map((u) => u.name),
    ...Object.values(DEVICE_NAMES),
    PENDING_TOKEN,
    PENDING_NAME,
  ];
  for (const text of forbidden) {
    if (all.includes(text)) throw new Error(`log line carries "${text}"`);
  }
}
