import { HttpError, log, prisma } from "@frejsi/shared";

import { noContent } from "@/app/api/auth/http";
import { requireMutation, spaceRoute } from "@/components/people/space-route";
import { removePasskey } from "@/lib/auth/webauthn";

const ROUTE = "spaces/passkeys/passkey";

/**
 * An owner removes a device of any member of the space (spec §2b). `removePasskey` deletes the
 * passkey and every session it opened, so that device is signed out at once, and emits
 * `device.removed`. A passkey of someone outside the space is 404, as if it did not exist.
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
    await removePasskey(passkeyId);
    log.info("people.device-removed", { route: ROUTE, spaceId, userId: session.userId });
    return noContent();
  },
);
