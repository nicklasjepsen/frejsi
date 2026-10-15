// The only place a user's presentation settings (locale, simpleMode, accent) are written. Both
// `/api/users/me` (one's own) and `/api/spaces/:id/settings/members/:userId` (an owner, for a
// member) call this; the caller has already decided who may change what.
import { HttpError, UserSettings } from "@frejsi/shared";

import { definedOnly, type UserSettingsPatch } from "@/components/settings/contracts";
import { run, type AuthDeps } from "@/lib/auth/core";

/**
 * Writes the given fields and emits `member.updated { userId }` to every space the user belongs
 * to (plan §4: a User column change is never `space.updated`), in one transaction.
 */
export function updateUserSettings(
  userId: string,
  patch: UserSettingsPatch,
  deps: AuthDeps = {},
): Promise<UserSettings> {
  return run(deps, async (tx, emit) => {
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (!existing) throw new HttpError(404, "not-found");
    const user = await tx.user.update({ where: { id: userId }, data: definedOnly(patch) });
    const memberships = await tx.membership.findMany({ where: { userId } });
    for (const membership of memberships) {
      await emit(membership.spaceId, "member.updated", { userId });
    }
    return UserSettings.parse({
      locale: user.locale,
      simpleMode: user.simpleMode,
      accent: user.accent,
    });
  });
}
