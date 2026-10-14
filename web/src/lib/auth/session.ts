import { cookies } from "next/headers";
import { HttpError, prisma, SessionContext, type PrismaClient, type Role } from "@frejsi/shared";

export const SESSION_COOKIE = "frejsi_session";
/** 90 days, as the cookie's Max-Age (plan §6). */
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** The Prisma delegates the session helpers use; tests pass a fake. */
export type SessionDb = Pick<PrismaClient, "session" | "user">;

export interface SessionDeps {
  db?: SessionDb;
  now?: () => Date;
}

/**
 * Loads the session row and its user with memberships (plan §6). Returns null for an unknown or
 * expired session. `Session.lastSeenAt` and `User.lastSeen` are touched at most once per hour.
 */
export async function loadSession(
  sessionId: string,
  deps: SessionDeps = {},
): Promise<SessionContext | null> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? (() => new Date());
  const at = now();

  const row = await db.session.findUnique({
    where: { id: sessionId },
    include: { user: { include: { memberships: true } } },
  });
  if (!row || row.expiresAt.getTime() <= at.getTime()) return null;

  if (at.getTime() - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: row.id }, data: { lastSeenAt: at } });
    await db.user.update({ where: { id: row.userId }, data: { lastSeen: at } });
  }

  return SessionContext.parse({
    userId: row.user.id,
    name: row.user.name,
    simpleMode: row.user.simpleMode,
    accent: row.user.accent,
    locale: row.user.locale,
    memberships: row.user.memberships.map((m) => ({ spaceId: m.spaceId, role: m.role })),
  });
}

/** The session behind the `frejsi_session` cookie of the current request, or null. */
export async function getSession(deps: SessionDeps = {}): Promise<SessionContext | null> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  return loadSession(id, deps);
}

/**
 * The membership of `session` in `spaceId` when its role is one of `roles` (any role when none
 * are given). Throws 404 for a non-member so space ids do not leak, 403 for an insufficient role
 * and for a missing session.
 */
export function assertRole(
  session: SessionContext | null,
  spaceId: string,
  ...roles: Role[]
): { session: SessionContext; role: Role } {
  if (!session) throw new HttpError(403, "forbidden");
  const membership = session.memberships.find((m) => m.spaceId === spaceId);
  if (!membership) throw new HttpError(404, "not-found");
  if (roles.length > 0 && !roles.includes(membership.role)) {
    throw new HttpError(403, "forbidden");
  }
  return { session, role: membership.role };
}

/** `assertRole` over the current request's session. Every API route calls this, not the UI. */
export async function requireRole(
  spaceId: string,
  ...roles: Role[]
): Promise<{ session: SessionContext; role: Role }> {
  return assertRole(await getSession(), spaceId, ...roles);
}
