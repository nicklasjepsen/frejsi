// Installability (spec §9, plan §8): the manifest and its icons are served. The service worker is
// for push only since v0.7.7: it registers, but a page load always comes from the network, so a slow
// worker wake-up can never hold the app on a blank page (docs/operations.md).
import { expect, test } from "./test";

interface Manifest {
  name: string;
  display: string;
  start_url: string;
  icons: { src: string; sizes: string; type: string }[];
}

test("the manifest is served with its icons", async ({ page, request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as Manifest;
  expect(manifest).toMatchObject({ name: "Nænsom", display: "standalone", start_url: "/" });
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.status(), icon.src).toBe(200);
    expect(image.headers()["content-type"]).toBe(icon.type);
  }

  await page.goto("/da/welcome");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
});

test("the service worker registers but never answers a page load", async ({ page }) => {
  await page.goto("/da/welcome");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const response = await page.reload();
  expect(response?.ok()).toBe(true);
  expect(response?.fromServiceWorker()).toBe(false);
});
