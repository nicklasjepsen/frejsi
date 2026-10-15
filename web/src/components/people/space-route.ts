// Plumbing shared by the People routes under /api/spaces/[spaceId]/: the dynamic params, and the
// order of checks every mutation makes (origin, then role, then body), so that nothing is parsed
// or written for a request that may not. Builds on the auth routes' `route()`, which turns a
// thrown HttpError into an ApiError response and one no-PII log line.
import type { Role, SessionContext } from "@frejsi/shared";

import { route } from "@/app/api/auth/http";
import { requireRole } from "@/lib/auth/session";
import { assertOrigin } from "@/lib/auth/webauthn";

export interface SpaceParams {
  spaceId: string;
}

export type SpaceHandler<P extends SpaceParams> = (
  request: Request,
  params: P,
) => Promise<Response>;

/** A Next.js route handler over `[spaceId]` (and deeper) params, wrapped like the auth routes. */
export function spaceRoute<P extends SpaceParams>(
  name: string,
  handler: SpaceHandler<P>,
): (request: Request, context: { params: Promise<P> }) => Promise<Response> {
  return (request, context) =>
    route(name, async (req) => handler(req, await context.params))(request);
}

/**
 * The gate in front of every write on People: the request comes from the app's own origin, and
 * the session holds one of `roles` in the space (any role when none are given). Owner-only
 * actions pass `"owner"`; a carer or viewer gets 403 here, in the API, not in the UI (spec §2).
 */
export async function requireMutation(
  request: Request,
  spaceId: string,
  ...roles: Role[]
): Promise<{ session: SessionContext; role: Role }> {
  assertOrigin(request.headers.get("origin"));
  return requireRole(spaceId, ...roles);
}
