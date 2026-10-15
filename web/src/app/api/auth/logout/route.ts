import { assertOrigin, logout } from "@/lib/auth/webauthn";

import { clearedSessionCookie, noContent, route, sessionIdFrom } from "../http";

/** Deletes the current session and clears the cookie. Without a cookie it only clears. */
export const POST = route("auth/logout", async (request) => {
  assertOrigin(request.headers.get("origin"));
  const sessionId = sessionIdFrom(request);
  if (sessionId) await logout(sessionId);
  return noContent({ cookie: clearedSessionCookie() });
});
