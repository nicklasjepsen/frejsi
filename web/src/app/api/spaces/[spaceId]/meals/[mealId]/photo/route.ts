import { z } from "zod";
import { json, parseBody, settingsRoute } from "@/components/settings/api-route";
import { authorizeMeal, mealOutcome } from "@/lib/meals/server";
import { setMealPhoto } from "@/lib/meals/service";

interface Params {
  spaceId: string;
  mealId: string;
}
const PhotoRequest = z.strictObject({ photoDataUrl: z.string().startsWith("data:image/") });
export const PUT = settingsRoute<Params>(
  "meals.photo.put",
  async (request, { spaceId, mealId }) => {
    const { session, deps } = await authorizeMeal(request, spaceId);
    const { photoDataUrl } = await parseBody(request, PhotoRequest);
    const meal = await setMealPhoto(spaceId, mealId, session, photoDataUrl, deps);
    mealOutcome(spaceId, session.userId, 1);
    return json(meal);
  },
);
export const DELETE = settingsRoute<Params>(
  "meals.photo.delete",
  async (request, { spaceId, mealId }) => {
    const { session, deps } = await authorizeMeal(request, spaceId);
    const meal = await setMealPhoto(spaceId, mealId, session, null, deps);
    mealOutcome(spaceId, session.userId, 1);
    return json(meal);
  },
);
