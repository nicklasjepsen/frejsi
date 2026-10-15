import { HttpError } from "@frejsi/shared";

import { settingsRoute } from "@/components/settings/api-route";
import { authorizeMeal } from "@/lib/meals/server";
import { HttpReadablePhotoStore } from "./photo-store";

interface Params {
  locale: string;
  mealId: string;
  spaceId?: string;
}

/** Same-origin photo bytes for the explicit save-as-dish action. The URL always comes from
 * the authorized meal's PhotoStore, never from a caller-supplied URL. No write happens here. */
export const GET = settingsRoute<Params>("meal-detail.photo", async (request, { mealId }) => {
  const spaceId = new URL(request.url).searchParams.get("space");
  if (!spaceId) throw new HttpError(400, "validation");
  const { deps } = await authorizeMeal(request, spaceId);
  const meal = await deps.repo.find(spaceId, mealId);
  if (!meal?.photoKey) throw new HttpError(404, "not-found");
  if (!deps.photos) throw new HttpError(503, "photo-unavailable");
  try {
    const photos = new HttpReadablePhotoStore(deps.photos);
    return new Response(await photos.read(meal.photoKey, "original", request.signal), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    throw new HttpError(503, "photo-unavailable");
  }
});
