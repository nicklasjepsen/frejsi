import { json } from "@/app/api/auth/http";
import { createEstimate } from "@/ai/estimate/service";
import { estimateBody, estimateRoute } from "./http";

export const POST = estimateRoute("estimates.create", async (request, context) => {
  const result = await createEstimate(
    context.spaceId,
    context.session,
    await estimateBody(request),
  );
  context.count = result.items.length;
  return json(result);
});

// This lane-owned read keeps capture available before the separate Settings lane lands.
export const GET = estimateRoute("estimates.status", async (_request, context) => {
  const { estimateStatus } = await import("@/ai/estimate/status");
  return json(await estimateStatus(context.spaceId, context.session));
});
