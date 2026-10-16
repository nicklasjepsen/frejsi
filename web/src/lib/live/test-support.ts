// Test doubles for the live feed: an in-memory stand-in for the delegates the live routes and
// `loadSession` read, a recording token issuer, and a fake socket. Imported by *.test.ts only.
import type { Reading, Role } from "@frejsi/shared";
import type { ClientToken, ClientTokenRequest, LiveTokenIssuer } from "@frejsi/shared";
import { vi } from "vitest";

import type { SessionDb } from "@/lib/auth/session";

import type { LiveDb } from "./server";
import type { SocketFactory, SocketLike } from "./live-feed";

type Row = Record<string, unknown>;

export interface FakeUser {
  id: string;
  name: string;
  simpleMode?: boolean;
  memberships: { spaceId: string; role: Role }[];
}

/**
 * The query shapes `loadSession`, `loadReadingsWindow`, `loadEventsPage` and the connect
 * handler's membership lookup use, over plain
 * arrays. Sessions never need a touch here (`lastSeenAt` is the test clock), so the two update
 * delegates only record that they were called.
 */
export class FakeLiveDb {
  users: FakeUser[] = [];
  sessions: { id: string; userId: string }[] = [];
  spaces: Row[] = [];
  readings: { spaceId: string; ts: Date; mmol: number; trend: string; source?: string }[] = [];
  events: { spaceId: string; seq: number; type: string; payload: string; ts: Date }[] = [];
  readonly updates: string[] = [];
  /** Runs inside `event.findMany`, before the rows are read: a write that commits mid-query. */
  duringEventQuery: (() => void) | null = null;

  constructor(private readonly now: () => Date) {}

  addSpace(id: string, extra: Row = {}): void {
    this.spaces.push({
      id,
      lastSeq: 0,
      sourceStatus: "not-configured",
      glucoseUnit: "mmol",
      targetLow: 4,
      targetHigh: 10,
      timezone: "Europe/Copenhagen",
      glucoseSource: null,
      ...extra,
    });
  }

  addMember(userId: string, spaceId: string, role: Role, sessionId = `sess-${userId}`): void {
    const user = this.users.find((u) => u.id === userId);
    if (user) user.memberships.push({ spaceId, role });
    else
      this.users.push({ id: userId, name: `Member ${userId}`, memberships: [{ spaceId, role }] });
    if (!this.sessions.some((s) => s.id === sessionId)) {
      this.sessions.push({ id: sessionId, userId });
    }
  }

  /** Appends an event the way `emit` would, allocating the space's next `seq`. */
  addEvent(spaceId: string, type: string, payload: unknown, ts: Date = this.now()): number {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space) throw new Error(`fake db: no space ${spaceId}`);
    const seq = (space.lastSeq as number) + 1;
    space.lastSeq = seq;
    this.events.push({ spaceId, seq, type, payload: JSON.stringify(payload), ts });
    return seq;
  }

  /** Stores a reading and its `reading` event, as the poller does. */
  addReading(spaceId: string, reading: Reading): void {
    this.readings.push({
      spaceId,
      ts: new Date(reading.ts),
      mmol: reading.mmol,
      trend: reading.trend,
    });
    this.addEvent(spaceId, "reading", reading, new Date(reading.ts));
  }

  get db(): LiveDb & SessionDb {
    const sessionDelegate = {
      findUnique: (args: { where: { id: string } }) => {
        const session = this.sessions.find((s) => s.id === args.where.id);
        const user = session ? this.users.find((u) => u.id === session.userId) : undefined;
        if (!session || !user) return Promise.resolve(null);
        const at = this.now();
        return Promise.resolve({
          id: session.id,
          userId: user.id,
          expiresAt: new Date(at.getTime() + 1000 * 60 * 60),
          lastSeenAt: at,
          user: {
            id: user.id,
            name: user.name,
            simpleMode: user.simpleMode ?? false,
            accent: "olive",
            locale: "da",
            memberships: user.memberships.map((m) => ({ ...m, userId: user.id })),
          },
        });
      },
      update: () => {
        this.updates.push("session");
        return Promise.resolve({});
      },
    };
    const userDelegate = {
      update: () => {
        this.updates.push("user");
        return Promise.resolve({});
      },
    };
    const spaceDelegate = {
      findUnique: (args: { where: { id: string } }) =>
        Promise.resolve(this.spaces.find((s) => s.id === args.where.id) ?? null),
    };
    const readingDelegate = {
      findMany: (args: { where: { spaceId: string; ts: { gte: Date } } }) =>
        Promise.resolve(
          this.readings
            .filter(
              (r) =>
                r.spaceId === args.where.spaceId && r.ts.getTime() >= args.where.ts.gte.getTime(),
            )
            .sort((a, b) => a.ts.getTime() - b.ts.getTime()),
        ),
      findFirst: (args: { where: { spaceId: string }; orderBy: { ts: "desc" } }) =>
        Promise.resolve(
          this.readings
            .filter((r) => r.spaceId === args.where.spaceId)
            .sort((a, b) => b.ts.getTime() - a.ts.getTime())[0] ?? null,
        ),
    };
    const eventDelegate = {
      findMany: (args: {
        where: {
          spaceId: string;
          seq: { gt: number; lte?: number };
          type?: { not: string } | { notIn: string[] };
        };
        take: number;
      }) => {
        this.duringEventQuery?.();
        return Promise.resolve(
          this.events
            .filter(
              (e) =>
                e.spaceId === args.where.spaceId &&
                e.seq > args.where.seq.gt &&
                (args.where.seq.lte === undefined || e.seq <= args.where.seq.lte) &&
                (args.where.type
                  ? "notIn" in args.where.type
                    ? !args.where.type.notIn.includes(e.type)
                    : e.type !== args.where.type.not
                  : true),
            )
            .sort((a, b) => a.seq - b.seq)
            .slice(0, args.take),
        );
      },
      findFirst: (args: {
        where: { spaceId: string; type?: string; seq?: { gt: number } };
        orderBy: { seq: "desc" };
      }) =>
        Promise.resolve(
          this.events
            .filter(
              (e) =>
                e.spaceId === args.where.spaceId &&
                (args.where.type ? e.type === args.where.type : true) &&
                (args.where.seq ? e.seq > args.where.seq.gt : true),
            )
            .sort((a, b) => b.seq - a.seq)[0] ?? null,
        ),
    };
    const membershipDelegate = {
      findUnique: (args: {
        where: { userId_spaceId: { userId: string; spaceId: string } };
        select?: { role?: boolean };
      }) => {
        const { userId, spaceId } = args.where.userId_spaceId;
        const membership = this.users
          .find((u) => u.id === userId)
          ?.memberships.find((m) => m.spaceId === spaceId);
        return Promise.resolve(membership ? { userId, spaceId, role: membership.role } : null);
      },
    };
    return {
      session: sessionDelegate,
      membership: membershipDelegate,
      user: userDelegate,
      space: spaceDelegate,
      reading: readingDelegate,
      event: eventDelegate,
    } as unknown as LiveDb & SessionDb;
  }
}

/** A `LiveTokenIssuer` that records every request; `url` null means "no Web PubSub" (503). */
export class RecordingIssuer implements LiveTokenIssuer {
  readonly requests: ClientTokenRequest[] = [];
  constructor(public url: string | null = "wss://example.webpubsub.azure.com/client/hubs/frejsi") {}

  issueClientToken(request: ClientTokenRequest): Promise<ClientToken | null> {
    this.requests.push(request);
    return Promise.resolve(this.url ? { url: `${this.url}?access_token=example` } : null);
  }
}

/** A socket the test opens, closes and feeds messages to by hand. */
export class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  /** The server dropped the connection (iOS killed the socket, token expired, network change). */
  drop(): void {
    this.closed = true;
    this.onclose?.();
  }
}

export function fakeSocketFactory(): { factory: SocketFactory; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}

/** A `fetch` over a table of handlers by path prefix; records every URL it was asked for. */
export function fakeFetch(handlers: Record<string, (url: URL) => Response | Promise<Response>>): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "https://frejsi.example",
    );
    calls.push(`${url.pathname}${url.search}`);
    const key = Object.keys(handlers).find((prefix) => url.pathname.endsWith(prefix));
    const handler = key ? handlers[key] : undefined;
    if (!handler) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A GET to `/api/spaces/:id/<path>` carrying the session cookie of `sessionId`, or no cookie. */
export function liveRequest(
  spaceId: string,
  path: string,
  sessionId: string | null,
  query: Record<string, string> = {},
): Request {
  const url = new URL(`https://frejsi.example/api/spaces/${spaceId}/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers: Record<string, string> = {};
  if (sessionId) headers.cookie = `frejsi_session=${sessionId}`;
  return new Request(url, { headers });
}

/** The `context` argument a `/api/spaces/[spaceId]/…` handler receives from Next. */
export const spaceContext = (spaceId: string) => ({ params: Promise.resolve({ spaceId }) });

/**
 * Captures every line the no-PII logger writes until `vi.restoreAllMocks()`. `all()` is the lines
 * without their `ts`: a wall-clock timestamp can spell any short number by accident.
 */
export function captureLog(): { lines: string[]; all(): string } {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  const withoutTs = (line: string): string => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    delete parsed.ts;
    return JSON.stringify(parsed);
  };
  return {
    lines,
    all: () =>
      lines
        .flatMap((chunk) => chunk.split("\n"))
        .filter((line) => line.trim() !== "")
        .map(withoutTs)
        .join("\n"),
  };
}
