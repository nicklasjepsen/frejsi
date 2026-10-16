import { json } from "@/app/api/auth/http";
import { askAboutEstimate } from "@/ai/estimate/service";
import { estimateBody, estimateRoute } from "../http";

export const POST = estimateRoute("estimates.ask", async (request, context) => {
  const result = await askAboutEstimate(
    context.spaceId,
    context.session,
    await estimateBody(request),
    context.deps,
  );
  context.count = 1;
  return json(result, { status: 201 });
});
