// The build check (release.yml): the built app's `/api/health` reports the version the release
// built and deploys, says the database answers and that the seed's readings are fresh.
import { expect, test } from "./test";

test("/api/health reports the release version", async ({ request }) => {
  const expected = process.env.E2E_APP_VERSION;
  expect(expected).toBeTruthy();
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({
    ok: true,
    version: expected,
    db: "ok",
    readings: "fresh",
  });
});

// Hand-written EXIF orientation/GPS-version and ICC markers on generated pixels, as in the
// processor's unit fixture. No coordinates or camera metadata from a person are used.
function taggedJpeg(jpeg: Buffer): Buffer {
  const tiff = Buffer.alloc(80);
  tiff.write("II");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(38, 30);
  tiff.writeUInt16LE(1, 38);
  tiff.writeUInt16LE(1, 42);
  tiff.writeUInt32LE(4, 44);
  tiff.set([2, 3, 0, 0], 48);
  const segment = (marker: number, bytes: Buffer) => {
    const header = Buffer.from([255, marker, 0, 0]);
    header.writeUInt16BE(bytes.length + 2, 2);
    return Buffer.concat([header, bytes]);
  };
  return Buffer.concat([
    jpeg.subarray(0, 2),
    segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0"), tiff])),
    segment(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01fictional-profile")),
    jpeg.subarray(2),
  ]);
}

test("the isolated standalone app processes and deletes both photo sizes", async ({
  page,
  request,
}) => {
  const { inviteLink, registerFromInvite, seededSpace } = await import("./support");
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const { spaceId } = await seededSpace();
  const root = `/api/spaces/${spaceId}/foods`;
  const created = await page.request.post(root, {
    data: { name: "Fictional photo check", portions: [{ label: "1 bowl", carbs: 20 }] },
  });
  expect(created.status()).toBe(201);
  const food = (await created.json()) as { id: string };
  const endpoint = `${root}/${food.id}`;
  try {
    // Generated pixels, no photo of a person or real product. A large input proves resizing.
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 1500;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas is unavailable");
      context.fillStyle = "#5A6A3B";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg");
    });
    const input = taggedJpeg(Buffer.from(dataUrl.split(",")[1] ?? "", "base64"));
    expect(input.includes(Buffer.from("Exif"))).toBe(true);
    expect(input.includes(Buffer.from("ICC_PROFILE"))).toBe(true);
    const uploaded = await page.request.put(`${endpoint}/photo`, {
      data: input,
      headers: { "content-type": "image/jpeg" },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(200);
    const saved = (await uploaded.json()) as { photo: { originalUrl: string; thumbUrl: string } };
    for (const [size, url] of Object.entries(saved.photo)) {
      const image = await request.get(url);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/jpeg");
      const bytes = await image.body();
      const dimensions = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        return [bitmap.width, bitmap.height];
      }, bytes.toString("base64"));
      expect(dimensions).toEqual(size === "originalUrl" ? [1200, 1600] : [320, 320]);
      expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
      expect(bytes.includes(Buffer.from("ICC_PROFILE"))).toBe(false);
    }
    const removed = await page.request.delete(endpoint);
    expect(removed.ok()).toBe(true);
    for (const url of Object.values(saved.photo))
      expect((await request.get(url)).status()).toBe(404);
  } finally {
    await page.request.delete(endpoint);
  }
});
