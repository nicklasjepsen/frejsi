// Server side of the live feed: the route plumbing the three `/api/spaces/:id/*` handlers share,
// the readings window and the events page. Never imported by a client component.
import {
  createEventSinkFromEnv,
  EventEnvelope,
  GlucoseSourceConfig,
  HttpError,
  log,
  prisma,
  SourceStatusPayload,
  type LiveTokenIssuer,
  type PrismaClient,
  type Role,
  type SessionContext,
} from "@frejsi/shared";

import { json, route, sessionIdFrom } from "@/app/api/auth/http";
import { assertRole, loadSession, type SessionDb } from "@/lib/auth/session";

import { EVENTS_PAGE_SIZE, type EventsPage, type ReadingsWindow } from "./contracts";

/** The Prisma delegates the live routes read; tests pass a fake. The routes write nothing. */
export type LiveDb = Pick<PrismaClient, "space" | "reading" | "event">;

/** What the three route handlers reach for; `configureLive` swaps them in tests. */
export interface LiveDeps {
  db: LiveDb & SessionDb;
  /** Issues the client token; the Web PubSub sink from the environment by default. */
  issuer: LiveTokenIssuer;
  now: () => Date;
}

let overrides: Partial<LiveDeps> = {};
let defaultIssuer: LiveTokenIssuer | undefined;

/** Tests only: replace the database, the token issuer or the clock the routes use. */
export function configureLive(deps: Partial<LiveDeps>): void {
  overrides = deps;
}

export function liveDeps(): LiveDeps {
  defaultIssuer ??= overrides.issuer ?? createEventSinkFromEnv();
  return {
    db: overrides.db ?? prisma,
    issuer: overrides.issuer ?? defaultIssuer,
    now: overrides.now ?? (() => new Date()),
  };
}

export interface SpaceRouteContext {
  params: Promise<{ spaceId: string }>;
}

export type SpaceRouteHandler = (request: Request, spaceId: string) => Promise<Response>;

/**
 * A GET handler for `/api/spaces/[spaceId]/…`: resolves the segment and turns any thrown value
 * into an `ApiError` response with one no-PII log line, through the same `route()` the auth
 * handlers use.
 */
export function spaceRoute(
  name: string,
  handler: SpaceRouteHandler,
): (request: Request, context: SpaceRouteContext) => Promise<Response> {
  return (request, context) =>
    route(name, async (req) => handler(req, (await context.params).spaceId))(request);
}

/**
 * The caller's membership in `spaceId`, from the session cookie on the request. 403 without a
 * session or with a role outside `roles`, 404 for a non-member so space ids do not leak (plan §6).
 * Every live route calls this before it reads anything; the UI is never the gate.
 */
export async function requireSpaceRole(
  request: Request,
  spaceId: string,
  roles: Role[] = [],
  db?: SessionDb,
): Promise<{ session: SessionContext; role: Role }> {
  const sessionId = sessionIdFrom(request);
  const session = sessionId ? await loadSession(sessionId, db ? { db } : {}) : null;
  return assertRole(session, spaceId, ...roles);
}

/** The integer query parameter `name`, validated by `schema`; a bad or missing value is a 400. */
export function queryNumber(
  request: Request,
  name: string,
  schema: { safeParse(value: unknown): { success: true; data: number } | { success: false } },
  fallback?: number,
): number {
  const raw = new URL(request.url).searchParams.get(name);
  if (raw === null && fallback !== undefined) return fallback;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "validation");
  return parsed.data;
}

export { json, log };

/** The source type on the space row, or null when none is configured or the JSON is unreadable. */
function sourceTypeOf(glucoseSource: string | null): ReadingsWindow["space"]["sourceType"] {
  if (!glucoseSource) return null;
  try {
    const parsed = GlucoseSourceConfig.safeParse(JSON.parse(glucoseSource));
    return parsed.success ? parsed.data.type : null;
  } catch {
    return null;
  }
}

/** One stored event row as the envelope the client parses; null for a row that no longer parses. */
export function envelopeOf(row: {
  spaceId: string;
  seq: number;
  type: string;
  payload: string;
  ts: Date;
}): EventEnvelope | null {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return null;
  }
  const parsed = EventEnvelope.safeParse({
    spaceId: row.spaceId,
    seq: row.seq,
    type: row.type,
    payload,
    ts: row.ts.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The readings of the last `hours` hours with the space's rendering settings and the sequence
 * cursor they are consistent with. The cursor is read first so a reading committed while the
 * window is loading is seen either in the window or in the next `events?since` page, never lost.
 * Owners and carers only: the caller has checked the role.
 */
export async function loadReadingsWindow(
  spaceId: string,
  hours: number,
  deps: { db?: LiveDb; now?: () => Date } = {},
): Promise<ReadingsWindow> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? (() => new Date());
  const space = await db.space.findUnique({
    where: { id: spaceId },
    select: {
      lastSeq: true,
      sourceStatus: true,
      glucoseUnit: true,
      targetLow: true,
      targetHigh: true,
      timezone: true,
      glucoseSource: true,
    },
  });
  if (!space) throw new HttpError(404, "not-found");

  const since = new Date(now().getTime() - hours * 60 * 60 * 1000);
  const [rows, statusRow] = await Promise.all([
    db.reading.findMany({
      where: { spaceId, ts: { gte: since } },
      orderBy: { ts: "asc" },
      select: { ts: true, mmol: true, trend: true },
    }),
    db.event.findFirst({
      where: { spaceId, type: "source.status" },
      orderBy: { seq: "desc" },
      select: { payload: true },
    }),
  ]);

  let sourceSince: string | null = null;
  if (statusRow) {
    try {
      const parsed = SourceStatusPayload.safeParse(JSON.parse(statusRow.payload));
      if (parsed.success) sourceSince = parsed.data.since;
    } catch {
      sourceSince = null;
    }
  }

  return {
    lastSeq: space.lastSeq,
    sourceStatus: space.sourceStatus as ReadingsWindow["sourceStatus"],
    sourceSince,
    space: {
      glucoseUnit: space.glucoseUnit as ReadingsWindow["space"]["glucoseUnit"],
      targetLow: Number(space.targetLow),
      targetHigh: Number(space.targetHigh),
      timezone: space.timezone,
      sourceType: sourceTypeOf(space.glucoseSource),
    },
    readings: rows.map((row) => ({
      ts: row.ts.toISOString(),
      mmol: Number(row.mmol),
      trend: row.trend as ReadingsWindow["readings"][number]["trend"],
    })),
  };
}

/**
 * The events after `since` in sequence order. A viewer's page never carries a `reading`: the
 * filter is in the query, so the rows do not even leave the database. `lastSeq` is the last row
 * reached before filtering, so a viewer does not re-read a stretch of readings on every poll.
 */
export async function loadEventsPage(
  spaceId: string,
  since: number,
  role: Role,
  db: LiveDb = prisma,
): Promise<EventsPage> {
  const rows = await db.event.findMany({
    where: {
      spaceId,
      seq: { gt: since },
      ...(role === "viewer" ? { type: { not: "reading" } } : {}),
    },
    orderBy: { seq: "asc" },
    take: EVENTS_PAGE_SIZE,
    select: { spaceId: true, seq: true, type: true, payload: true, ts: true },
  });
  const events: EventEnvelope[] = [];
  for (const row of rows) {
    const envelope = envelopeOf(row);
    if (envelope) events.push(envelope);
  }
  const more = rows.length === EVENTS_PAGE_SIZE;
  let lastSeq = rows.at(-1)?.seq ?? since;
  if (!more && role === "viewer") {
    // The viewer's filtered page may end before the latest reading; move the cursor past it so
    // the next poll does not return the same empty stretch, without touching the row.
    const latest = await db.event.findFirst({
      where: { spaceId, seq: { gt: lastSeq } },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    if (latest) lastSeq = latest.seq;
  }
  return { lastSeq, events, more };
}
