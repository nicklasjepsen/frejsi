import { HttpError } from "@frejsi/shared";

import { settingsRoute } from "@/components/settings/api-route";
import { authorizeMeal } from "@/lib/meals/server";
import { getMeal } from "@/lib/meals/service";

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
  const { session, deps } = await authorizeMeal(request, spaceId);
  const meal = await getMeal(spaceId, mealId, session.locale, deps);
  if (!meal.photo) throw new HttpError(404, "not-found");
  try {
    const photo = await fetch(meal.photo.originalUrl, {
      cache: "no-store",
      signal: request.signal,
    });
    if (!photo.ok) throw new Error("photo-unavailable");
    return new Response(photo.body, {
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
