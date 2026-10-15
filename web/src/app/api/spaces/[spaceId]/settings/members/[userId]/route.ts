import { HttpError, prisma } from "@frejsi/shared";

import { json, logOutcome, parseBody, settingsRoute } from "@/components/settings/api-route";
import { UserSettingsPatch } from "@/components/settings/contracts";
import { updateUserSettings } from "@/app/api/users/me/user-settings";
import { requireRole } from "@/lib/auth/session";

const ROUTE = "spaces.settings.members";

/**
 * An owner sets another member's language, view and colour (plan task 9: "an owner for anyone in
 * the space"). The target must be in this space; the write emits `member.updated` to every space
 * the target belongs to.
 */
export const PATCH = settingsRoute<{ spaceId: string; userId: string }>(
  ROUTE,
  async (request, { spaceId, userId }) => {
    await requireRole(spaceId, "owner");
    const patch = await parseBody(request, UserSettingsPatch);
    const member = await prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
    });
    if (!member) throw new HttpError(404, "not-found");
    const settings = await updateUserSettings(userId, patch);
    logOutcome("settings.member-updated", ROUTE, "ok", { spaceId, userId });
    return json(settings);
  },
);
