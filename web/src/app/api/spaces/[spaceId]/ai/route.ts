import { json, settingsRoute } from "@/components/settings/api-route";
import { requireRole } from "@/lib/auth/session";
import { loadAiUsage } from "./usage";

export const GET = settingsRoute<{ spaceId: string }>(
  "spaces.ai",
  async (_request, { spaceId }) => {
    await requireRole(spaceId, "owner", "carer");
    return json(await loadAiUsage(spaceId));
  },
);
