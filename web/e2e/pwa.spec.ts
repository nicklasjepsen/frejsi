// Installability and the offline shell (spec §9, plan §8): the manifest and its icons are
// served, and after a first visit the service worker answers a navigation without a network.
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
  expect(manifest).toMatchObject({ name: "Frejsi", display: "standalone", start_url: "/" });
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

test("after the first visit the shell loads offline", async ({ page, context }) => {
  await page.goto("/da/welcome");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ingen forbindelse lige nu" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
