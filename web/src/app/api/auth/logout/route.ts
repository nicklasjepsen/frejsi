import { assertOrigin, logout } from "@/lib/auth/webauthn";
import { clearedThemeCookie } from "@/lib/theme/theme";

import { clearedSessionCookie, noContent, route, sessionIdFrom } from "../http";

/**
 * Deletes the current session and clears the session cookie, and the theme cookie with it: the
 * theme is the person's, not the device's. Without a session cookie it only clears.
 */
export const POST = route("auth/logout", async (request) => {
  assertOrigin(request.headers.get("origin"));
  const sessionId = sessionIdFrom(request);
  if (sessionId) await logout(sessionId);
  return noContent({ cookie: [clearedSessionCookie(), clearedThemeCookie()] });
});
