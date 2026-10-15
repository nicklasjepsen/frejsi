import { HttpError } from "@frejsi/shared";
import { json } from "@/app/api/auth/http";
import { setFoodPhoto } from "@/lib/foods";
import { foodRoute, photoBytes } from "../../http";

export const PUT = foodRoute("foods.photo.put", async (request, context) => {
  if (!context.deps.photos) throw new HttpError(503, "photo-unavailable");
  const food = await context.deps.db.food.findFirst({
    where: { id: context.foodId, spaceId: context.spaceId },
  });
  if (!food) throw new HttpError(404, "not-found");
  const updated = await setFoodPhoto(
    context.spaceId,
    context.session,
    context.foodId,
    await photoBytes(request),
    context.deps,
  );
  context.count = 1;
  return json(updated);
});
export const DELETE = foodRoute("foods.photo.delete", async (_request, context) => {
  const food = await setFoodPhoto(
    context.spaceId,
    context.session,
    context.foodId,
    null,
    context.deps,
  );
  context.count = 1;
  return json(food);
});
