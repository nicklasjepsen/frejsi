import { HttpError, log } from "@frejsi/shared";
import { processPhoto } from "@frejsi/shared/photos";
import { route, sessionIdFrom } from "@/app/api/auth/http";
import { loadSession } from "@/lib/auth/session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";
import { SharedRecipe } from "@/lib/recipes/contracts";
import { shareStore } from "@/lib/recipes/share-store";

/** A shared image is at most this big, as a food photo is. */
const PHOTO_LIMIT = 8 * 1024 * 1024;
const BODY_LIMIT = PHOTO_LIMIT + 64 * 1024;
const SEE_OTHER = 303;

const text = (value: FormDataEntryValue | null, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

/**
 * The Web Share Target receiver (plan §6, decision 11), outside the locale middleware so the
 * phone's POST is not redirected to a page. The share is kept ten minutes in process memory under
 * a random id bound to the session, and the browser is sent to the recipe form, which loads it
 * once. A signed-out share goes to welcome and keeps nothing. The log carries the id, never the
 * title, text, URL or image.
 */
export const POST = route("share.receive", async (request) => {
  const sessionId = sessionIdFrom(request);
  const session = sessionId ? await loadSession(sessionId) : null;
  const locale = resolveLocale(session?.locale);
  if (!session || !sessionId) {
    log.warn("share.rejected", { route: "share.receive", code: "forbidden" });
    return redirect(request, localeHref(locale, "/welcome"));
  }
  if (session.simpleMode) return redirect(request, localeHref(locale, "/now"));
  if (Number(request.headers.get("content-length")) > BODY_LIMIT)
    throw new HttpError(400, "photo-too-large");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "validation");
  }
  const share: Record<string, string> = {};
  const title = text(form.get("title"), 500);
  const body = text(form.get("text"), 4000);
  const url = text(form.get("url"), 2000);
  if (title) share.title = title;
  if (body) share.text = body;
  // Some share sheets put the link in `text`; a URL there is the page, not a note.
  const link = url ?? (body && /^https:\/\/\S+$/.test(body) ? body : undefined);
  if (link && SharedRecipe.shape.url.safeParse(link).success) share.url = link;
  const file = form.get("files");
  if (file instanceof Blob && file.size > 0) {
    if (!file.type.startsWith("image/")) throw new HttpError(400, "photo-type");
    if (file.size > PHOTO_LIMIT) throw new HttpError(400, "photo-too-large");
    try {
      const { original } = await processPhoto(new Uint8Array(await file.arrayBuffer()));
      share.photoDataUrl = `data:image/jpeg;base64,${Buffer.from(original).toString("base64")}`;
    } catch {
      throw new HttpError(400, "photo-type");
    }
  }
  const parsed = SharedRecipe.safeParse(share);
  if (!parsed.success || Object.keys(parsed.data).length === 0)
    throw new HttpError(400, "validation");
  const id = shareStore().put(sessionId, parsed.data);
  log.info("share.received", { route: "share.receive", code: "ok", userId: session.userId });
  return redirect(request, `${localeHref(locale, "/recipe/new")}?share=${encodeURIComponent(id)}`);
});

function redirect(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url), SEE_OTHER);
}
