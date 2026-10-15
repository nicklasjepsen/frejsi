import { deflateSync } from "node:zlib";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { processPhoto } from "./process";

// Synthetic two-colour image, with a hand-written TIFF containing orientation and fictional GPS.
function orientedPhoto() {
  const pixels = Buffer.alloc(2000 * 1500 * 4);
  for (let y = 0; y < 1500; y++) {
    for (let x = 0; x < 2000; x++) {
      const offset = (y * 2000 + x) * 4;
      pixels[offset + (x < 1000 ? 0 : 2)] = 255;
      pixels[offset + 3] = 255;
    }
  }
  const encoded = jpeg.encode({ width: 2000, height: 1500, data: pixels }, 85).data;
  const tiff = Buffer.alloc(80);
  tiff.write("II");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  // Orientation = 6 (90 degrees clockwise).
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  // GPS IFD pointer, followed by GPSVersionID = 2.3.0.0.
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(38, 30);
  tiff.writeUInt16LE(1, 38);
  tiff.writeUInt16LE(1, 42);
  tiff.writeUInt32LE(4, 44);
  tiff.set([2, 3, 0, 0], 48);
  const app = (marker: number, bytes: Buffer) => {
    const header = Buffer.from([0xff, marker, 0, 0]);
    header.writeUInt16BE(bytes.length + 2, 2);
    return Buffer.concat([header, bytes]);
  };
  return Buffer.concat([
    encoded.subarray(0, 2),
    app(0xe1, Buffer.concat([Buffer.from("Exif\0\0"), tiff])),
    app(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01fictional-profile")),
    encoded.subarray(2),
  ]);
}

// Minimal generated RGBA PNG, without another native image dependency in tests.
function png(width: number, height: number) {
  function chunk(type: string, data: Buffer) {
    const content = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const end = Buffer.alloc(4);
    end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, content, end]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function decode(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  expect(buffer.subarray(0, 2)).toEqual(Buffer.from([255, 216]));
  // APP1/APP2 markers would retain EXIF/GPS/XMP/ICC even if tags were renamed.
  let offset = 2;
  while (buffer[offset] === 0xff && buffer[offset + 1] !== 0xda) {
    expect([0xe1, 0xe2, 0xed, 0xfe]).not.toContain(buffer[offset + 1]);
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  expect(buffer.includes(Buffer.from("Exif"))).toBe(false);
  expect(buffer.includes(Buffer.from("ICC_PROFILE"))).toBe(false);
  return jpeg.decode(buffer, { useTArray: true });
}

function colour(image: ReturnType<typeof decode>, x: number, y: number) {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(offset, offset + 3));
}

describe("processPhoto", () => {
  it("orients the original and square thumb, bounds dimensions and strips all metadata", async () => {
    const input = orientedPhoto();
    expect(jpeg.decode(input).width).toBe(2000);
    expect(input.includes(Buffer.from("Exif"))).toBe(true);
    expect(input.includes(Buffer.from([0x25, 0x88]))).toBe(true);
    expect(input.includes(Buffer.from("ICC_PROFILE"))).toBe(true);
    const photos = await processPhoto(input);
    const original = decode(photos.original);
    expect([original.width, original.height]).toEqual([1200, 1600]);
    const thumb = decode(photos.thumb);
    expect([thumb.width, thumb.height]).toEqual([320, 320]);
    for (const image of [original, thumb]) {
      const top = colour(image, Math.floor(image.width / 2), 20);
      const bottom = colour(image, Math.floor(image.width / 2), image.height - 20);
      expect(top[0]).toBeGreaterThan(240);
      expect(top[2]).toBeLessThan(15);
      expect(bottom[0]).toBeLessThan(15);
      expect(bottom[2]).toBeGreaterThan(240);
    }
  });

  it("accepts PNG, flattens transparency to white and does not enlarge the original", async () => {
    const photos = await processPhoto(png(12, 8));
    const original = decode(photos.original);
    expect([original.width, original.height]).toEqual([12, 8]);
    expect(colour(original, 0, 0)).toEqual([255, 255, 255]);
    const thumb = decode(photos.thumb);
    expect([thumb.width, thumb.height]).toEqual([320, 320]);
  });

  it("accepts a generated WebP", async () => {
    // A synthetic 1×1 lossless white WebP (VP8L).
    const webp = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");
    const photos = await processPhoto(webp);
    const original = decode(photos.original);
    expect([original.width, original.height]).toEqual([1, 1]);
  });

  it("rejects 9 MB before decoding", async () => {
    await expect(processPhoto(new Uint8Array(9 * 1024 * 1024))).rejects.toThrow("photo-too-large");
  });

  it.each([
    Buffer.from("%PDF-1.7\nfictional"),
    Buffer.from("00000018667479706865696300000000686569636d696631", "hex"),
    Buffer.from("GIF89afictional"),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
    Buffer.alloc(0),
    Buffer.from([255, 216, 255, 224, 0, 16]),
  ])("rejects unsupported or corrupt bytes with a stable error", async (bytes) => {
    await expect(processPhoto(bytes)).rejects.toThrow("photo-type");
  });
});
