import { expect, it } from "vitest";
import sharp from "sharp";
import { preparePhoto, validatePhoto, photoPath } from "./photo";
it("strips metadata, bounds dimensions and stores JPEG bytes", async () => {
  const input = await sharp({
    create: { width: 1700, height: 80, channels: 3, background: "#ffffff" },
  })
    .withMetadata()
    .jpeg()
    .toBuffer();
  await expect(validatePhoto(input)).rejects.toThrow();
  const bytes = await preparePhoto(input);
  await expect(validatePhoto(bytes)).resolves.toBeUndefined();
  const metadata = await sharp(bytes).metadata();
  expect(metadata.format).toBe("jpeg");
  expect(metadata.width).toBe(1600);
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  await expect(validatePhoto(await sharp(bytes).png().toBuffer())).rejects.toThrow();
});
it("rejects image paths outside the image folder", () => {
  for (const name of [
    "../outside.jpg",
    "/outside.jpg",
    "nested/plate.jpg",
    "plate.png",
    "..\\outside.jpg",
  ])
    expect(() => photoPath(name)).toThrow();
  expect(photoPath("plate.jpg")).toMatch(/images\/plate.jpg$/);
});
