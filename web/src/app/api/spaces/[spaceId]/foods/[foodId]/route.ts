import { UpdateFoodRequest } from "@frejsi/shared";
import { json, noContent, parseBody } from "@/app/api/auth/http";
import { deleteFood, getFood, updateFood } from "@/lib/foods";
import { foodRoute } from "../http";

export const GET = foodRoute("foods.get", async (_request, context) => {
  const food = await getFood(context.spaceId, context.session, context.foodId, context.deps);
  context.count = 1;
  return json(food);
});
export const PATCH = foodRoute("foods.update", async (request, context) => {
  const patch = await parseBody(request, UpdateFoodRequest);
  const food = await updateFood(
    context.spaceId,
    context.session,
    context.foodId,
    patch,
    context.deps,
  );
  context.count = 1;
  return json(food);
});
export const DELETE = foodRoute("foods.delete", async (_request, context) => {
  await deleteFood(context.spaceId, context.session, context.foodId, context.deps);
  context.count = 1;
  return noContent();
});
