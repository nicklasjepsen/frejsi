import { HttpError, UserSettings } from "@frejsi/shared";

import { json, logOutcome, parseBody, settingsRoute } from "@/components/settings/api-route";
import { UserSettingsPatch } from "@/components/settings/contracts";
import { getSession } from "@/lib/auth/session";
import { themeCookie } from "@/lib/theme/theme";

import { updateUserSettings } from "./user-settings";

const ROUTE = "users.me";

/** The signed-in user's own presentation settings. */
export const GET = settingsRoute(ROUTE, async () => {
  const session = await getSession();
  if (!session) throw new HttpError(403, "forbidden");
  return json(
    UserSettings.parse({
      locale: session.locale,
      simpleMode: session.simpleMode,
      accent: session.accent,
      theme: session.theme,
    }),
  );
});

/**
 * A person changes their own language, view, colour and theme (plan task 9). A viewer may change
 * only language, colour and theme: `simpleMode` means nothing in the viewer shell, and the rule is
 * enforced here, not in the screen. Emits `member.updated` to every space of the user. A theme
 * change also sets the `frejsi_theme` cookie on this device, so the next page paints right from
 * the start (web/src/lib/theme/theme.ts); an owner's write for another member sets no cookie.
 */
export const PATCH = settingsRoute(ROUTE, async (request) => {
  const session = await getSession();
  if (!session) throw new HttpError(403, "forbidden");
  const patch = await parseBody(request, UserSettingsPatch);
  const mayUseSimpleMode = session.memberships.some((m) => m.role !== "viewer");
  if (patch.simpleMode !== undefined && !mayUseSimpleMode) throw new HttpError(403, "forbidden");
  const settings = await updateUserSettings(session.userId, patch);
  logOutcome("settings.user-updated", ROUTE, "ok", { userId: session.userId });
  return json(settings, patch.theme === undefined ? {} : { cookie: themeCookie(patch.theme) });
});
