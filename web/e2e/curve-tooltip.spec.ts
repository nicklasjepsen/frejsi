// The curve's tooltip (issue 243) on the seeded owner's curves, at 360 and 1280 px, light and dark.
// The checks are on the DOM and computed styles, not pixel snapshots: a runner's font rasteriser
// differs from a workstation's by a few pixels, which is no finding. Screenshots are kept as release
// artifacts for a human eye.
import type { Locator, Page } from "@playwright/test";

import { inviteLink, registerFromInvite } from "./support";
import { expect, test } from "./test";

const CLOCK = /kl\. \d{2}:\d{2}/;
const AGE = /siden|lige nu/;
const VALUE = /\d+,\d mmol\/L/;
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("The element has no box");
  return box;
}

/**
 * Moves the mouse across the plot and checks every tooltip it shows: a value always carries its
 * clock and age, and the card stays inside the chart. Returns what it read.
 */
async function sweep(page: Page, host: Locator): Promise<string[]> {
  await host.scrollIntoViewIfNeeded();
  const box = await boxOf(host);
  const tip = host.getByTestId("curve-tooltip");
  const seen: string[] = [];
  for (let share = 0.04; share < 0.96; share += 0.06) {
    await page.mouse.move(box.x + box.width * share, box.y + box.height * 0.3);
    if (!(await tip.isVisible())) continue;
    const text = (await tip.textContent()) ?? "";
    seen.push(text);
    if (VALUE.test(text)) {
      expect(text).toMatch(CLOCK);
      expect(text).toMatch(AGE);
      await expect(host.getByTestId("curve-guide")).toBeVisible();
      await expect(host.getByTestId("curve-dot")).toBeVisible();
    }
    const card = await boxOf(tip);
    expect(card.x, `"${text}" inside the chart`).toBeGreaterThanOrEqual(box.x - 1);
    expect(card.x + card.width, `"${text}" inside the chart`).toBeLessThanOrEqual(
      box.x + box.width + 1,
    );
  }
  expect(
    seen.some((text) => VALUE.test(text)),
    "a reading was read",
  ).toBe(true);
  // Leaving the plot hides the tooltip.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
  await expect(tip).toHaveCount(0);
  return seen;
}

/** The tooltip's colours in this scheme, read from a reading under the pointer. */
async function tooltipColours(page: Page, host: Locator) {
  const box = await boxOf(host);
  const tip = host.getByTestId("curve-tooltip");
  for (let share = 0.5; share < 0.95; share += 0.05) {
    await page.mouse.move(box.x + box.width * share, box.y + box.height * 0.3);
    if (await tip.isVisible()) break;
  }
  await expect(tip).toBeVisible();
  return tip.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      color: style.color,
      events: style.pointerEvents,
      position: style.position,
    };
  });
}

test("the curves read the reading or entry under the pointer, the finger and the keys", async ({
  page,
}, testInfo) => {
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = isDesktop(page);

  if (desktop) {
    // Nu: the day curve reads under the pointer.
    const now = page.getByTestId("now-desktop").getByTestId("curve-host").first();
    await expect(now).toBeVisible();
    await sweep(page, now);
  } else {
    // The phone's Nu curve is the sparkline, which stays silent.
    await expect(page.getByTestId("now-phone").getByTestId("curve-host")).toHaveCount(0);
  }

  await page.goto("/da/history");
  const day = page.getByTestId("history-day").first().getByTestId("curve-host").first();
  await expect(day).toBeVisible();
  const seen = await sweep(page, day);
  // Whatever the pointer is on, the tooltip names it with its time.
  for (const text of seen) expect(text).toMatch(/\d{2}:\d{2}/);

  // Light and dark: the card is drawn in the scheme's own surface and text, over the chart.
  const colours: Record<string, { background: string; color: string }> = {};
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const style = await tooltipColours(page, day);
    expect(style.position).toBe("absolute");
    expect(style.events).toBe("none");
    expect(style.color, `${colorScheme} text readable`).not.toBe(style.background);
    colours[colorScheme] = style;
    await day.screenshot({ path: testInfo.outputPath(`curve-tooltip-${colorScheme}.png`) });
  }
  expect(colours.dark?.background).not.toBe(colours.light?.background);

  // The keys: the guide moves one reading per arrow and the text is announced.
  await page.mouse.move(0, 0);
  await day.focus();
  await page.keyboard.press("ArrowLeft");
  const live = day.getByTestId("curve-live");
  await expect(live).toHaveText(CLOCK);
  await expect(live).toHaveText(AGE);
  const first = await live.textContent();
  await page.keyboard.press("ArrowLeft");
  await expect(live).not.toHaveText(first ?? "");
  await page.keyboard.press("Escape");
  await expect(live).toHaveText("");

  if (!desktop) {
    // The finger: the plot takes it (no panning), a touch-and-hold shows the tooltip.
    expect(await day.evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
    const box = await boxOf(day);
    const point = { clientX: box.x + box.width * 0.7, clientY: box.y + box.height * 0.3 };
    await day.dispatchEvent("pointerdown", { ...point, pointerType: "touch", bubbles: true });
    await expect(day.getByTestId("curve-tooltip")).toBeVisible();
    await day.dispatchEvent("pointerup", { ...point, pointerType: "touch", bubbles: true });
    await expect(day.getByTestId("curve-tooltip")).toHaveCount(0);
  }
});
