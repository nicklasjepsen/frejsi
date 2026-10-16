import { ContributionsView } from "@frejsi/shared/schemas/food";
import { json, parseBody } from "@/app/api/auth/http";
import { availableContributions, contributeFood } from "@/lib/contributions";
import { z } from "zod";
import { contributionRoute } from "./http";

const SendRequest = z.strictObject({ foodId: z.string().min(1).max(64) });

export const GET = contributionRoute("contributions.get", (_request, context) =>
  Promise.resolve(
    json(
      ContributionsView.parse(
        availableContributions(context.spaceId, context.session, context.deps),
      ),
    ),
  ),
);
export const POST = contributionRoute("contributions.send", async (request, context) => {
  const { foodId } = await parseBody(request, SendRequest);
  await contributeFood(context.spaceId, context.session, foodId, context.deps);
  return json({ status: "ok" });
});
