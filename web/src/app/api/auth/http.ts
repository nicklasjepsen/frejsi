// Shared plumbing of the auth and bootstrap route handlers: body parsing, the session cookie,
// and the one place a thrown error becomes an ApiError response and a no-PII log line.
import { log, toApiError, HttpError } from "@frejsi/shared";
import type { z } from "zod";

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

/** The `Set-Cookie` value that signs a device in (plan §6). */
export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

/** The `Set-Cookie` value that signs a device out. */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** The session id in the request's cookie header, or null. */
export function sessionIdFrom(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/** The JSON body validated by `schema`; anything else is a 400 `validation`. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "validation");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "validation");
  return parsed.data;
}

export function json(body: unknown, init: { status?: number; cookie?: string } = {}): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.cookie) headers.append("set-cookie", init.cookie);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export function noContent(init: { cookie?: string } = {}): Response {
  const headers = new Headers();
  if (init.cookie) headers.append("set-cookie", init.cookie);
  return new Response(null, { status: 204, headers });
}

/**
 * Wraps a handler so that any thrown value becomes an `ApiError` response with a stable code and
 * one log line carrying the route and the code only. Nothing from the request reaches the log or
 * the client (plan §9).
 */
export function route(
  name: string,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      const { status, body } = toApiError(error);
      if (status >= 500) {
        log.error("api.failed", { route: name, code: body.error.code }, error);
      } else {
        log.warn("api.rejected", { route: name, code: body.error.code });
      }
      return json(body, { status });
    }
  };
}
