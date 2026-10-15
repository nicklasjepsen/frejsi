import sharp from "sharp";
import type { PhotoBytes } from "./types";

/** Decode untrusted bytes on the server; never preserve a camera's metadata. */
export async function processPhoto(bytes: Uint8Array): Promise<PhotoBytes> {
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("photo-too-large");
  try {
    const image = sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("photo-type");
    const upright = image.autoOrient().flatten({ background: "#ffffff" });
    // sharp drops EXIF, GPS, XMP and ICC by default. Do not call keepMetadata/withMetadata.
    const original = await upright
      .clone()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const thumb = await upright
      .clone()
      .resize(320, 320, { fit: "cover" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { original, thumb };
  } catch {
    // Native decoder errors may contain uploaded metadata; expose only the domain error.
    throw new Error("photo-type");
  }
}
