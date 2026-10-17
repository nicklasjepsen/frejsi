import { z } from "zod";
import { noContent } from "@/app/api/auth/http";
import { json, parseBody, settingsRoute } from "@/components/settings/api-route";
import { WRITE_ROLES, authorizeSymptoms, symptomOutcome } from "@/lib/symptoms/server";
import { deleteSymptom, updateSymptom } from "@/lib/symptoms/service";

interface Params {
  spaceId: string;
  symptomId: string;
}
const RawBody = z.record(z.string(), z.unknown());
export const PATCH = settingsRoute<Params>(
  "symptoms.update",
  async (request, { spaceId, symptomId }) => {
    const { session, deps } = await authorizeSymptoms(request, spaceId, WRITE_ROLES);
    const body = await parseBody(request, RawBody);
    const symptom = await updateSymptom(spaceId, symptomId, session, body, deps);
    symptomOutcome(spaceId, session.userId, 1);
    return json(symptom);
  },
);
export const DELETE = settingsRoute<Params>(
  "symptoms.delete",
  async (request, { spaceId, symptomId }) => {
    const { session, deps } = await authorizeSymptoms(request, spaceId, WRITE_ROLES);
    await deleteSymptom(spaceId, symptomId, session, deps);
    symptomOutcome(spaceId, session.userId, 1);
    return noContent();
  },
);
