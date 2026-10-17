import { json } from "@/app/api/auth/http";
import { spaceRoute } from "@/lib/live/server";
import { authorizeSymptoms } from "@/lib/symptoms/server";
import { listSymptomKinds } from "@/lib/symptoms/service";

/** The space's own kinds beyond the six defaults, for the picker and the Say sheet; every role. */
export const GET = spaceRoute("symptoms.kinds", async (request, spaceId) => {
  const { deps } = await authorizeSymptoms(request, spaceId, []);
  return json({ kinds: await listSymptomKinds(spaceId, deps) });
});
