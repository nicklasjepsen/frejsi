import { HttpError } from "@frejsi/shared";
import { processPhoto } from "@frejsi/shared/photos";

export const PHOTO_LIMIT = 8 * 1024 * 1024;
export const PHOTO_URL_LIMIT = "data:image/jpeg;base64,".length + 4 * Math.ceil(PHOTO_LIMIT / 3);

/** Validate the declared type, decoded size and actual image before calling a provider. */
export async function estimateImage(value: unknown): Promise<Uint8Array> {
  if (typeof value !== "string") throw new HttpError(400, "photo-type");
  if (value.length > PHOTO_URL_LIMIT) throw new HttpError(400, "photo-too-large");
  const prefix = "data:image/jpeg;base64,";
  if (!value.startsWith(prefix)) throw new HttpError(400, "photo-type");
  const base64 = value.slice(prefix.length);
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    throw new HttpError(400, "photo-type");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64) throw new HttpError(400, "photo-type");
  if (bytes.byteLength > PHOTO_LIMIT) throw new HttpError(400, "photo-too-large");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    throw new HttpError(400, "photo-type");
  try {
    // Strip metadata before sending; this does not store anything.
    return (await processPhoto(bytes)).original;
  } catch {
    throw new HttpError(400, "photo-type");
  }
}
