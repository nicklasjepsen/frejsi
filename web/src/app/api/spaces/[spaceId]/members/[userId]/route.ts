import {
  createEventSinkFromEnv,
  groupFor,
  log,
  prisma,
  type LiveGroupRevoker,
} from "@frejsi/shared";

import { noContent, parseBody } from "@/app/api/auth/http";
import { ChangeRoleBody } from "@/components/people/contract";
import { requireMutation, spaceRoute } from "@/components/people/space-route";
import { revokeInvite } from "@/lib/auth/invites";
import { changeMemberRole, removeMember } from "@/lib/auth/members";

const ROUTE = "spaces/members/user";

let live: LiveGroupRevoker | undefined;

/** Each live-transport call gets this long; the change has committed and the owner is waiting. */
const ATTEMPT_MS = 2_000;

/** Runs one call with its own deadline, aborting it (and the SDK's retries) when it passes. */
function bounded(call: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("live call timed out"));
    }, ATTEMPT_MS);
  });
  return Promise.race([call(controller.signal), deadline]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Takes the member's open sockets out of the groups they may no longer hear, after the change has
 * committed (issue #79). A failed or slow removal is tried once more. If a group still keeps
 * them, every socket of theirs is closed instead: the client reconnects through `negotiate`,
 * which issues a token for the role they have now. Only if that fails too is it logged as
 * `live-revoke-failed`, with ids only; the change stands either way.
 */
async function leaveGroups(spaceId: string, userId: string, groups: string[]): Promise<void> {
  const transport = (live ??= createEventSinkFromEnv());
  const remove = (group: string) =>
    bounded((signal) => transport.removeUserFromGroup(group, userId, { signal }));
  const results = await Promise.allSettled(groups.map((g) => remove(g).catch(() => remove(g))));
  if (results.every((r) => r.status === "fulfilled")) return;
  const fields = { route: ROUTE, spaceId, userId };
  try {
    await bounded((signal) => transport.closeUserConnections(userId, { signal }));
    log.warn("people.live-revoke-closed", { ...fields, code: "live-revoke-closed" });
  } catch {
    log.error("people.live-revoke-failed", { ...fields, code: "live-revoke-failed" });
  }
}

/**
 * Reads the role as it is after the commit. A racing change back to `carer` or `owner` that
 * committed after this one keeps glucose, so its socket must not be taken out of the group.
 */
async function isViewerNow(spaceId: string, userId: string): Promise<boolean> {
  const row = await prisma.membership.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
  });
  return row?.role === "viewer";
}

/**
 * An owner changes a member's role (spec §2). `changeMemberRole` emits `member.updated` in the
 * same transaction and refuses to demote the last owner (`last-owner`, 409).
 */
export const PATCH = spaceRoute<{ spaceId: string; userId: string }>(
  ROUTE,
  async (request, { spaceId, userId }) => {
    const { session } = await requireMutation(request, spaceId, "owner");
    const { role } = await parseBody(request, ChangeRoleBody);
    await changeMemberRole({ spaceId, userId, role });
    if (role === "viewer" && (await isViewerNow(spaceId, userId))) {
      await leaveGroups(spaceId, userId, [groupFor(spaceId, "reading")]);
    }
    log.info("people.role-changed", { route: ROUTE, spaceId, userId: session.userId });
    return noContent();
  },
);

/**
 * An owner removes a member (spec §2). `removeMember` emits `member.removed`; the removed
 * member's next request for the space is 404 because `requireRole` finds no membership. The
 * last owner cannot be removed (`last-owner`). Their open add-a-device links are withdrawn after,
 * each with `invite.revoked`, so the list does not offer to resend a link nobody can use.
 */
export const DELETE = spaceRoute<{ spaceId: string; userId: string }>(
  ROUTE,
  async (request, { spaceId, userId }) => {
    const { session } = await requireMutation(request, spaceId, "owner");
    await removeMember({ spaceId, userId });
    await leaveGroups(spaceId, userId, [
      groupFor(spaceId, "reading"),
      groupFor(spaceId, "member.removed"),
    ]);
    const deviceLinks = await prisma.invite.findMany({
      where: {
        spaceId,
        forUserId: userId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    for (const invite of deviceLinks) await revokeInvite(invite.token);
    log.info("people.member-removed", {
      route: ROUTE,
      spaceId,
      userId: session.userId,
      linksWithdrawn: deviceLinks.length,
    });
    return noContent();
  },
);
