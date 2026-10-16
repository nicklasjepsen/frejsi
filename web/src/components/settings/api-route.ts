// Server-side plumbing of the Settings routes: the one place a thrown error becomes an ApiError
// response and a no-PII log line that carries the route, the outcome code and the ids only.
import { log, toApiError, type ApiErrorCode, type LogFields } from "@frejsi/shared";

import { json } from "@/app/api/auth/http";

export { json, parseBody } from "@/app/api/auth/http";

/** The ids a Settings log line may carry (plan §9); never a name, a value or a credential. */
export interface RouteIds {
  spaceId?: string;
  userId?: string;
}

/** `{ msg, route, code, ids }` as one log line; info for a success, warn for a refusal. */
export function logOutcome(
  msg: string,
  route: string,
  code: ApiErrorCode | "ok" | "bad-credentials" | "unreachable",
  ids: RouteIds = {},
): void {
  const fields: LogFields = { route, code };
  if (ids.spaceId) fields.spaceId = ids.spaceId;
  if (ids.userId) fields.userId = ids.userId;
  if (code === "ok") log.info(msg, fields);
  else log.warn(msg, fields);
}

/**
 * Wraps a handler that takes the awaited route params. A thrown `HttpError` becomes its response
 * and one log line with the route, the code and the `spaceId` from the path; anything else is a
 * 500 `internal` with the error's class name only.
 */
export function settingsRoute<P extends { spaceId?: string }>(
  name: string,
  handler: (request: Request, params: P) => Promise<Response>,
): (request: Request, context?: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    // A route without a dynamic segment is called with `{}` params by Next and with nothing by tests.
    const params: Partial<P> = (await context?.params) ?? {};
    try {
      return await handler(request, params as P);
    } catch (error) {
      const { status, body } = toApiError(error);
      const fields: LogFields = { route: name, code: body.error.code };
      if (params.spaceId) fields.spaceId = params.spaceId;
      if (status >= 500) log.error("api.failed", fields, error);
      else log.warn("api.rejected", fields);
      return json(body, { status });
    }
  };
}
