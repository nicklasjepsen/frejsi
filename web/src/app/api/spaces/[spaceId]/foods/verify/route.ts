import { VerifyFoodsRequest } from "@frejsi/shared";
import { json, parseBody } from "@/app/api/auth/http";
import { verifyFoods } from "@/lib/foods";
import { foodRoute } from "../http";

export const POST = foodRoute("foods.verify", async (request, context) => {
  const { foodIds } = await parseBody(request, VerifyFoodsRequest);
  const foods = await verifyFoods(context.spaceId, context.session, foodIds, context.deps);
  context.count = foods.length;
  return json(foods);
});
