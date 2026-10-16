import { HttpError } from "@frejsi/shared";
import { foodRoute } from "../foods/http";
import { PHOTO_URL_LIMIT } from "@/ai/estimate/photo";

export const estimateRoute = foodRoute;

/** Bounded JSON even with a missing or dishonest Content-Length. */
export async function estimateBody(request: Request): Promise<unknown> {
  const limit = PHOTO_URL_LIMIT + 32_000;
  if (Number(request.headers.get("content-length")) > limit)
    throw new HttpError(400, "photo-too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "validation");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(400, "photo-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "validation");
  }
}
