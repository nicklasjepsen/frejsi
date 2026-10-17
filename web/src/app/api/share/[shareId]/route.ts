import { HttpError } from "@frejsi/shared";
import { json, route, sessionIdFrom } from "@/app/api/auth/http";
import { loadSession } from "@/lib/auth/session";
import { shareStore } from "@/lib/recipes/share-store";

/** The form's one load of a share. A second load, another session or ten minutes later: `share-expired`. */
export const GET = async (request: Request, context: { params: Promise<{ shareId: string }> }) =>
  route("share.take", async (req) => {
    const sessionId = sessionIdFrom(req);
    const session = sessionId ? await loadSession(sessionId) : null;
    if (!session || !sessionId) throw new HttpError(403, "forbidden");
    if (session.simpleMode) throw new HttpError(400, "simple-mode");
    const { shareId } = await context.params;
    const share = shareStore().take(shareId, sessionId);
    if (!share) throw new HttpError(410, "share-expired");
    return json(share);
  })(request);
