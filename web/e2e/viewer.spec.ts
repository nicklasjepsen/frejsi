// The viewer never receives glucose (spec §2, plan §8): Lærke signs in from an add-a-device link,
// gets the viewer shell, and no page she can open draws a value or carries a reading over the
// wire, whatever the API is asked.
import { expect, test } from "@playwright/test";

import { inviteLink, navLabels, registerFromInvite, seededSpace } from "./support";

const PAGES = [
  "/da/soon/today",
  "/da/soon/earlier-days",
  "/da/now",
  "/da/settings",
  "/da/settings/colour",
  "/da/settings/source",
  "/da/people",
];

/** Anything that draws a glucose value, a trend or the curve. */
const GLUCOSE = [
  '[data-testid="glucose-number"]',
  '[data-testid="glucose-age"]',
  "svg[data-trend]",
  '[data-testid="curve"]',
  '[data-testid="lone-point"]',
  '[data-testid="preview-reading"]',
].join(", ");

/**
 * A reading's value (`"mmol":6.2`), plain or escaped inside the RSC payload's script strings. The
 * messages carry the unit's label under the same key (`"mmol":"mmol/L"`), so a digit must follow.
 */
const READING_KEY = /mmol\\?"\s*:\s*(\\?")?\d/;

test("a viewer gets the viewer shell and no glucose on any page", async ({ page }) => {
  const space = await seededSpace();
  await registerFromInvite(page, await inviteLink("laerke"));
  await page.waitForURL(/\/da\/soon\/today$/);
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-variant", "viewer");
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  expect(await navLabels(page)).toEqual([
    "I dag",
    "Tidligere dage",
    desktop ? "Indstillinger" : "Mere",
  ]);

  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(GLUCOSE), path).toHaveCount(0);
    // What the server sends for the page, the RSC payload included: no reading object in it.
    const html = await (await page.request.get(path)).text();
    expect(html, path).not.toMatch(READING_KEY);
  }

  // The API itself, not only the screens (§3b).
  const readings = await page.request.get(`/api/spaces/${space.spaceId}/readings?hours=24`);
  expect(readings.status()).toBe(403);
  const events = await page.request.get(`/api/spaces/${space.spaceId}/events?since=0`);
  expect(events.status()).toBe(200);
  const feed = (await events.json()) as { lastSeq: number; events: { type: string }[] };
  expect(feed.events.length).toBeGreaterThan(0);
  expect(feed.events.filter((event) => event.type === "reading")).toEqual([]);
  expect(feed.lastSeq).toBeGreaterThan(space.readings);
});
