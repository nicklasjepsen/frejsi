import { log } from "@frejsi/shared";

import { BOOTSTRAP_TOKEN_HEADER, bootstrapSpace } from "@/lib/auth/bootstrap";

import { json, route } from "../auth/http";

/**
 * One-shot: creates the first space and returns the owner's invitation URL once (plan §6). Dead
 * (404) as soon as any space exists; 401 on a wrong `x-bootstrap-token`. The token and the URL
 * never reach a log line: the logger's allow-list has no key that could carry them.
 */
export const POST = route("bootstrap", async (request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const result = await bootstrapSpace({ token: request.headers.get(BOOTSTRAP_TOKEN_HEADER), body });
  log.info("bootstrap.done", { route: "bootstrap", spaceId: result.spaceId });
  return json({
    spaceId: result.spaceId,
    inviteUrl: result.inviteUrl,
    expiresAt: result.expiresAt.toISOString(),
  });
});
