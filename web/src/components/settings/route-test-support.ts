// The fixture every Settings route test starts from: one space with an owner, a carer and a viewer,
// each signed in on a session. Imported by *.test.ts only.
import type { FakeAuthDb } from "@/lib/auth/test-support";

export const T0 = new Date("2026-10-15T08:00:00.000Z");
export const ORIGIN = "https://frejsi.example";

export const SESSIONS = {
  owner: "sess-owner",
  carer: "sess-carer",
  viewer: "sess-viewer",
  stranger: "sess-stranger",
} as const;
export type Who = keyof typeof SESSIONS;

export const USERS = { owner: "u-owner", carer: "u-carer", viewer: "u-viewer", stranger: "u-stranger" };

/** Seeds `s1` with its three members and `s2`, a second space the carer is also in as owner. */
export function seedSpace(fake: FakeAuthDb): void {
  const expiresAt = new Date(T0.getTime() + 60 * 60 * 1000);
  const space = {
    timezone: "Europe/Copenhagen",
    glucoseUnit: "mmol",
    targetLow: 4,
    targetHigh: 10,
    glucoseSource: null,
    sourceStatus: "not-configured",
    sourceFailures: 0,
    lastReadingAt: null,
    lastSeq: 0,
    createdAt: T0,
  };
  fake.rows("space").push({ id: "s1", name: "Example space", ...space });
  fake.rows("space").push({ id: "s2", name: "Second space", ...space });
  const person = { simpleMode: false, accent: "olive", locale: "da", createdAt: T0 };
  fake.rows("user").push({ id: USERS.owner, name: "Example Owner", ...person });
  fake.rows("user").push({ id: USERS.carer, name: "Example Carer", ...person });
  fake.rows("user").push({ id: USERS.viewer, name: "Example Viewer", ...person });
  fake.rows("user").push({ id: USERS.stranger, name: "Example Stranger", ...person });
  fake.rows("membership").push({ userId: USERS.owner, spaceId: "s1", role: "owner", createdAt: T0 });
  fake.rows("membership").push({ userId: USERS.carer, spaceId: "s1", role: "carer", createdAt: T0 });
  fake.rows("membership").push({ userId: USERS.viewer, spaceId: "s1", role: "viewer", createdAt: T0 });
  fake.rows("membership").push({ userId: USERS.carer, spaceId: "s2", role: "owner", createdAt: T0 });
  for (const who of Object.keys(SESSIONS) as Who[]) {
    fake.rows("session").push({ id: SESSIONS[who], userId: USERS[who], expiresAt, lastSeenAt: T0 });
  }
}

export function request(
  path: string,
  init: { method?: string; body?: unknown; as?: Who | null } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.as !== null) headers.cookie = `frejsi_session=${SESSIONS[init.as ?? "owner"]}`;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined
      ? {}
      : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
  });
}

/** The `next/headers` cookies() stand-in: reads the cookie header of the request under test. */
export function cookieStoreFor(current: () => Request | null) {
  return () =>
    Promise.resolve({
      get: (name: string) => {
        const header = current()?.headers.get("cookie") ?? "";
        for (const part of header.split(";")) {
          const [k, ...rest] = part.trim().split("=");
          if (k === name) return { value: rest.join("=") };
        }
        return undefined;
      },
    });
}

export const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });
