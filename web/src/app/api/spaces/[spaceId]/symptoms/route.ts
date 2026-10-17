import { z } from "zod";
import { json, parseBody } from "@/app/api/auth/http";
import { spaceRoute } from "@/lib/live/server";
import { WRITE_ROLES, authorizeSymptoms, symptomOutcome } from "@/lib/symptoms/server";
import { createSymptom, listSymptoms } from "@/lib/symptoms/service";

/** Every member reads symptoms, a viewer included: kinds, times, notes and names, never a reading. */
export const GET = spaceRoute("symptoms.list", async (request, spaceId) => {
  const { session, deps } = await authorizeSymptoms(request, spaceId, []);
  const params = new URL(request.url).searchParams;
  const view = await listSymptoms(
    spaceId,
    { from: params.get("from") ?? undefined, to: params.get("to") ?? undefined },
    deps,
  );
  symptomOutcome(spaceId, session.userId, view.symptoms.length);
  return json(view);
});

/** The body is read raw: the service decides what a simpleMode session may send. */
const RawBody = z.record(z.string(), z.unknown());
export const POST = spaceRoute("symptoms.create", async (request, spaceId) => {
  const { session, deps } = await authorizeSymptoms(request, spaceId, WRITE_ROLES);
  const body = await parseBody(request, RawBody);
  const symptom = await createSymptom(spaceId, session, body, deps);
  symptomOutcome(spaceId, session.userId, 1);
  return json(symptom, { status: 201 });
});
