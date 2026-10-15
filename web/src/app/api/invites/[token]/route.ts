import { log } from "@frejsi/shared";

import { json, route } from "../../auth/http";
import { inviteView } from "../invite-view";

/**
 * The invitation behind a link, as `InviteView` only (spec §2b, task 6). Public: the token is the
 * key. 404 for an unknown token; 410 with the state (`invite-used`, `invite-revoked`,
 * `invite-expired`) for a dead one, so the landing page can say what happened without learning
 * anything about the space. The log line carries the route and the code, never the token.
 */
export function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return route("invites/[token]", async () => {
    const { token } = await context.params;
    const view = await inviteView(token);
    log.info("invite.viewed", { route: "invites/[token]" });
    return json(view);
  })(request);
}
