import { GlucoseImportRequest } from "@frejsi/shared";

import { json, parseBody } from "@/app/api/auth/http";
import { authorizeImport, importOutcome } from "@/lib/import/server";
import { importGlucose } from "@/lib/import/service";
import { spaceRoute } from "@/lib/live/server";

/**
 * An owner imports an export file (Dexcom Clarity today) into the space (#154): readings the
 * space does not have, and the file's carb entries as meals when asked. Owners only, in the API;
 * the answer is counts, and the log line is counts and ids.
 */
export const POST = spaceRoute("spaces.import", async (request, spaceId) => {
  const { session, deps } = await authorizeImport(request, spaceId);
  const body = await parseBody(request, GlucoseImportRequest);
  const result = await importGlucose(spaceId, session, body, deps);
  importOutcome(spaceId, session.userId, result.readings.added);
  return json(result);
});
