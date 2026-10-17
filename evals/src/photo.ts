import path from "node:path";
import sharp from "sharp";
import { processPhoto } from "@frejsi/shared/photos";
export function photoPath(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.jpe?g$/.test(name)) throw new Error("invalid photo filename");
  return path.resolve(import.meta.dirname, "../cases/photo/images", name);
}
/** A recipe page photo the owner supplies, under evals/fixtures (plan task 7). */
export function recipePhotoPath(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.jpe?g$/.test(name)) throw new Error("invalid photo filename");
  return path.resolve(import.meta.dirname, "../fixtures", name);
}
export async function validatePhoto(bytes: Uint8Array): Promise<void> {
  const m = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  if (
    m.format !== "jpeg" ||
    m.width > 1600 ||
    m.height > 1600 ||
    m.exif ||
    m.xmp ||
    m.icc ||
    m.iptc ||
    m.comments?.length
  )
    throw new Error("photo must be JPEG, at most 1600 px, without metadata");
}
export async function preparePhoto(bytes: Uint8Array): Promise<Uint8Array> {
  const { original } = await processPhoto(bytes);
  await validatePhoto(original);
  return original;
}
