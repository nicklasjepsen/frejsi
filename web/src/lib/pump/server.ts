// The pump route's plumbing (v0.7.0 plan §4): who may read, and the swappable database and clock.
import { HttpError, prisma, type SessionContext } from "@frejsi/shared";

import type { SessionDb } from "@/lib/auth/session";
import { requireSpaceRole } from "@/lib/live/server";

import type { PumpReadDb } from "./history";

export interface PumpDeps {
  db: PumpReadDb;
  sessionDb: SessionDb;
  now: () => Date;
}

let overrides: Partial<PumpDeps> = {};
/** Tests only: replace the database, the session database or the clock. */
export function configurePump(deps: Partial<PumpDeps>): void {
  overrides = deps;
}

export function pumpDeps(): PumpDeps {
  return {
    db: overrides.db ?? prisma,
    sessionDb: overrides.sessionDb ?? prisma,
    now: overrides.now ?? (() => new Date()),
  };
}

/**
 * Pump history is for owners and carers outside simpleMode (CLAUDE.md hard rules): a viewer is 403
 * by role and a simpleMode session is 403 by mode, here in the API, before anything is read.
 */
export async function authorizePump(
  request: Request,
  spaceId: string,
  deps: PumpDeps,
): Promise<SessionContext> {
  const { session } = await requireSpaceRole(
    request,
    spaceId,
    ["owner", "carer"],
    deps.sessionDb,
    deps.now,
  );
  if (session.simpleMode) throw new HttpError(403, "forbidden");
  return session;
}
