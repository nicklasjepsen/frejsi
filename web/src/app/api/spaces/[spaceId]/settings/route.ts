import { HttpError, prisma } from "@frejsi/shared";

import { json, logOutcome, parseBody, settingsRoute } from "@/components/settings/api-route";
import { SpaceSettingsPatch } from "@/components/settings/contracts";
import { requireRole } from "@/lib/auth/session";

import { toSpaceSettings, updateSpaceSettings } from "./space-settings";

const ROUTE = "spaces.settings";
interface Params {
  spaceId: string;
}

/** The space settings for owners and carers; a viewer is 403 here, in the API (plan task 9). */
export const GET = settingsRoute<Params>(ROUTE, async (_request, { spaceId }) => {
  await requireRole(spaceId, "owner", "carer");
  const row = await prisma.space.findUnique({ where: { id: spaceId } });
  if (!row) throw new HttpError(404, "not-found");
  return json(toSpaceSettings(row));
});

/** Owners change the unit and the target range; the answer is the settings as they now are. */
export const PATCH = settingsRoute<Params>(ROUTE, async (request, { spaceId }) => {
  await requireRole(spaceId, "owner");
  const patch = await parseBody(request, SpaceSettingsPatch);
  const settings = await updateSpaceSettings(spaceId, patch);
  logOutcome("settings.space-updated", ROUTE, "ok", { spaceId });
  return json(settings);
});
