import { HttpError, log } from "@frejsi/shared";
import { ParseRequest } from "@frejsi/shared/schemas/ai";
import { parseForSession } from "@/ai/parse/service";
import { parseBody } from "@/app/api/auth/http";
import { json, requireSpaceRole, spaceRoute } from "@/lib/live/server";
import { parseDeps, parseSessionDb } from "./server";

export const POST = spaceRoute("parse.post", async (request, spaceId) => {
  const { session } = await requireSpaceRole(
    request,
    spaceId,
    ["owner", "carer"],
    parseSessionDb(),
  );
  if (session.simpleMode) throw new HttpError(400, "simple-mode");
  const { text } = await parseBody(request, ParseRequest);
  const deps = parseDeps();
  let count = 0;
  try {
    const provider = await deps.provider(spaceId, session);
    const { meal } = await parseForSession({ ...deps, provider }, spaceId, session, text, () => {
      count++;
    });
    log.info("parse.finished", { spaceId, userId: session.userId, count });
    return json(meal);
  } catch (error) {
    const safe = error instanceof HttpError ? error : new HttpError(503, "ai-unavailable");
    log.warn("parse.failed", { spaceId, userId: session.userId, count, code: safe.code });
    throw safe;
  }
});
