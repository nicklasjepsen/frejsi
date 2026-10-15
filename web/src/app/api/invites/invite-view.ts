// What the invitation landing page may know about a link (task 6): the `InviteView` contract
// from @frejsi/shared and nothing else. The route and the page both read through here, so the
// space id, the member list and the token itself never reach the browser as data.
import { InviteView, Role } from "@frejsi/shared";

import type { DbDeps } from "@/lib/auth/core";
import { loadInvite } from "@/lib/auth/invites";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days until the link expires, rounded up: a link with a few hours left says "1 day", and a
 * link that is still valid never says 0 (`InviteView.daysLeft` is a non-negative integer).
 */
export function daysLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * The view for a link that can still be used. Throws `loadInvite`'s `HttpError` otherwise
 * (`not-found`, `invite-used`, `invite-revoked`, `invite-expired`), which carries only the code.
 */
export async function inviteView(token: string, deps: DbDeps = {}): Promise<InviteView> {
  const invite = await loadInvite(token, deps);
  const now = deps.now ?? (() => new Date());
  return InviteView.parse({
    name: invite.name,
    spaceName: invite.space.name,
    role: Role.parse(invite.role),
    inviterName: invite.creator.name,
    daysLeft: daysLeft(invite.expiresAt, now()),
    forExistingUser: invite.forUserId !== null,
  });
}
