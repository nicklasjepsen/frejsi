// The viewer never receives glucose (spec §2, plan §8): Lærke signs in from an add-a-device link,
// gets the viewer shell, and no page she can open draws a value or carries a reading over the
// wire, whatever the API is asked.
import { prisma } from "@frejsi/shared";
import { expect, test } from "./test";

import { inviteLink, navLabels, registerFromInvite, seededSpace } from "./support";

const PAGES = [
  "/da/today",
  "/da/soon/earlier-days",
  "/da/history",
  "/da/history/week",
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

const FORBIDDEN = new Set([
  "mmol",
  "mgdl",
  "trend",
  "reading",
  "readings",
  "glucose",
  "peak",
  "inRange",
  "inRangePercent",
  "stats",
  "curve",
  "bolusTs",
  "bolusLead",
  "bolusLeadMinutes",
]);
function assertMealOnly(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertMealOnly(item);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      expect(FORBIDDEN.has(key), key).toBe(false);
      assertMealOnly(item);
    }
  }
}

test.use({ serviceWorkers: "block" });

test("a viewer gets the viewer shell and no glucose on any page", async ({ page }) => {
  let checkedBodies = 0;
  // Read each response before delivering it to the page: Chromium discards bodies on navigation.
  // Fetch exactly once, preserving redirects and the real auth/API responses.
  await page.route("**/*", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const type = response.headers()["content-type"] ?? "";
    if (/json|html|text\/x-component/.test(type)) {
      const text = await response.text();
      if (type.includes("json") && new URL(response.url()).pathname.startsWith("/api/spaces/")) {
        assertMealOnly(JSON.parse(text) as unknown);
      }
      expect(text, response.url()).not.toMatch(READING_KEY);
      expect(text, response.url()).not.toMatch(
        /trend\\?"\s*:\s*\\?"(?:flat|up|down|double-up|double-down|up-slight|down-slight)/,
      );
      expect(text, response.url()).not.toMatch(/type\\?"\s*:\s*\\?"reading\\?"/);
      if (new URL(response.url()).pathname.startsWith("/api/")) {
        expect(text, response.url()).not.toMatch(
          /"(?:mmol|mgdl|trend|reading|readings|glucose)"\s*:/i,
        );
      }
      checkedBodies++;
    }
    await route.fulfill({ response });
  });
  const space = await seededSpace();
  await registerFromInvite(page, await inviteLink("laerke"));
  await page.waitForURL(/\/da\/today$/);
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-variant", "viewer");
  await expect(page.getByTestId("day-total")).toHaveText(/102\s*g kulhydrat indtil nu/);
  await expect(page.getByTestId("day-list").getByTestId("meal-card")).toHaveCount(3);
  await expect(page.getByTestId("day-list")).toContainText("Havregrød med æble");
  await expect(page.getByTestId("day-list")).toContainText("Rugbrød med ost og Æble");
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  expect(await navLabels(page)).toEqual([
    "I dag",
    "Tidligere dage",
    desktop ? "Indstillinger" : "Mere",
  ]);

  await page
    .getByTestId(desktop ? "sidebar" : "phone-tabs")
    .getByRole("link", { name: "Tidligere dage", exact: true })
    .click();
  await page.waitForURL(/\/da\/history$/);
  const days = page.getByTestId("viewer-days");
  await expect(days.getByRole("heading", { name: "Tidligere dage", exact: true })).toBeVisible();
  await expect(days.locator("section").first().getByTestId("meal-card")).toHaveCount(3);
  await expect(days.locator("section").first()).toContainText("Rugbrød med ost og Æble");

  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(GLUCOSE), path).toHaveCount(0);
    // What the server sends for the page, the RSC payload included: no reading object in it.
    const html = await (await page.request.get(path)).text();
    expect(html, path).not.toMatch(READING_KEY);
  }

  // The API itself, not only the screens (§3b).
  const meal = await prisma.meal.findFirstOrThrow({ where: { spaceId: space.spaceId } });
  for (const route of [`meals/${meal.id}/curve`, "history/day", "history/week"]) {
    const denied = await page.request.get(`/api/spaces/${space.spaceId}/${route}`);
    expect(denied.status(), route).toBe(403);
    assertMealOnly(await denied.json());
  }
  const readings = await page.request.get(`/api/spaces/${space.spaceId}/readings?hours=24`);
  expect(readings.status()).toBe(403);
  const events = await page.request.get(`/api/spaces/${space.spaceId}/events?since=0`);
  expect(events.status()).toBe(200);
  const feed = (await events.json()) as { lastSeq: number; events: { type: string }[] };
  assertMealOnly(feed);
  expect(feed.events.length).toBeGreaterThan(0);
  expect(feed.events.filter((event) => event.type === "reading")).toEqual([]);
  expect(feed.lastSeq).toBeGreaterThan(space.readings);
  expect(checkedBodies).toBeGreaterThan(PAGES.length);
});
