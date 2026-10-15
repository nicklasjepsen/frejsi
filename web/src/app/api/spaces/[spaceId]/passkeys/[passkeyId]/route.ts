import { HttpError, log, prisma } from "@frejsi/shared";
import { cookies } from "next/headers";

import { clearedSessionCookie, json } from "@/app/api/auth/http";
import type { RemovedDeviceView } from "@/components/people/contract";
import { requireMutation, spaceRoute } from "@/components/people/space-route";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { removePasskey } from "@/lib/auth/webauthn";

const ROUTE = "spaces/passkeys/passkey";

/**
 * An owner removes a device of any member of the space (spec §2b). `removePasskey` deletes the
 * passkey and every session it opened, so that device is signed out at once, and emits
 * `device.removed`. A passkey of someone outside the space is 404, as if it did not exist.
 *
 * The last device any owner of a space can sign in with cannot be removed (409 `last-owner`): a
 * new device only comes in through an owner's add-a-device link, so without it nobody could ever
 * get back in. Every space the device's user owns is checked, since a passkey is the user's, not
 * the space's.
 *
 * When the device removed is the one making the request, its session is among those gone: the
 * answer says `signedOut: true` and clears the cookie, so the screen goes to sign-in instead of
 * reloading a list it may no longer read.
 */
export const DELETE = spaceRoute<{ spaceId: string; passkeyId: string }>(
  ROUTE,
  async (request, { spaceId, passkeyId }) => {
    const { session } = await requireMutation(request, spaceId, "owner");
    const passkey = await prisma.passkey.findUnique({ where: { id: passkeyId } });
    if (!passkey) throw new HttpError(404, "not-found");
    const membership = await prisma.membership.findUnique({
      where: { userId_spaceId: { userId: passkey.userId, spaceId } },
    });
    if (!membership) throw new HttpError(404, "not-found");

    await assertOwnersKeepADevice(passkey.userId, passkeyId);

    const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
    const current = sessionId
      ? await prisma.session.findUnique({ where: { id: sessionId } })
      : null;
    const signedOut = current?.passkeyId === passkeyId;

    await removePasskey(passkeyId);
    log.info("people.device-removed", {
      route: ROUTE,
      spaceId,
      userId: session.userId,
      signedOut,
    });
    const body: RemovedDeviceView = { signedOut };
    return json(body, signedOut ? { cookie: clearedSessionCookie() } : {});
  },
);

/**
 * 409 `last-owner` when removing `passkeyId` would leave a space that `userId` owns with no owner
 * who has a device. The check and the delete are not one transaction: two owners removing each
 * other's last device in the same instant could both pass. Rare enough for a family's space, and
 * `removePasskey` belongs to the auth core.
 */
async function assertOwnersKeepADevice(userId: string, passkeyId: string): Promise<void> {
  const owned = await prisma.membership.findMany({ where: { userId, role: "owner" } });
  for (const { spaceId } of owned) {
    const owners = await prisma.membership.findMany({ where: { spaceId, role: "owner" } });
    const left = await prisma.passkey.count({
      where: { userId: { in: owners.map((o) => o.userId) }, id: { not: passkeyId } },
    });
    if (left === 0) throw new HttpError(409, "last-owner");
  }
}
