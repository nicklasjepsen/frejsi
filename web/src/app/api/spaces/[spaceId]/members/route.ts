import { log } from "@frejsi/shared";

import { json } from "@/app/api/auth/http";
import { loadPeople } from "@/components/people/load-people";
import { spaceRoute } from "@/components/people/space-route";
import { requireRole } from "@/lib/auth/session";

/**
 * The members of the space with their devices, and the pending invitations (`PeopleView`). Any
 * member may read it, a viewer included: there is no glucose in it and no schema for any (spec
 * §2). A non-member gets 404 so space ids do not leak.
 */
export const GET = spaceRoute("spaces/members", async (_request, { spaceId }) => {
  const { session } = await requireRole(spaceId);
  const view = await loadPeople(spaceId);
  log.info("people.listed", {
    route: "spaces/members",
    spaceId,
    userId: session.userId,
    count: view.members.length,
  });
  return json(view);
});
