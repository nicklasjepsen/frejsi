// A space without a sensor (v0.5.0, spec §3 and §7): Mette is a carer in "Arnes rum", whose
// source is `manual`. She types a finger-prick value, the hero shows it with its age and no arrow,
// and the write has its `reading` event. Lærke, a viewer, can neither write nor receive a value.
import { prisma } from "@frejsi/shared";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";

import { SEED_ARNES_READINGS } from "../scripts/seed";
import {
  assertMealOnly,
  inviteLink,
  registerFromInvite,
  seededArnesRoom,
  seededSpace,
  switchToSpace,
} from "./support";

test.use({ serviceWorkers: "block" });

/** The hero this width draws: the phone's or the desktop's, never both. */
function hero(page: Page) {
  return page.getByTestId("glucose-number").filter({ visible: true });
}

async function readingEvents(spaceId: string, ts: string): Promise<number> {
  const events = await prisma.event.findMany({ where: { spaceId, type: "reading" } });
  return events.filter((event) => (JSON.parse(event.payload) as { ts: string }).ts === ts).length;
}

async function enter(page: Page, value: string): Promise<void> {
  await page
    .getByRole("button", { name: "Indtast måling" })
    .filter({ visible: true })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Indtast måling" });
  await sheet.getByLabel("Måling i mmol/L").fill(value);
  await sheet.getByRole("button", { name: "Nu", exact: true }).click();
  const saving = page.waitForResponse(
    (response) => response.url().endsWith("/readings") && response.request().method() === "POST",
  );
  await sheet.getByRole("button", { name: "Gem måling" }).click();
  expect((await saving).status()).toBe(200);
  await expect(sheet).toBeHidden();
}

test("Mette switches to Arnes rum and types a finger-prick value", async ({ page }) => {
  const room = await seededArnesRoom();
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  await registerFromInvite(page, await inviteLink("mette"));
  await page.waitForURL(/\/da\/now$/);
  // The pill is the sensor's before the switch and "Manuelt" after it, with no reload in between.
  await expect(page.getByRole("status").filter({ visible: true })).toContainText("Dexcom Share");
  await switchToSpace(page, "Arnes rum");
  await page.waitForURL(/\/da\/now$/);
  await expect(page.getByRole("status").filter({ visible: true })).toContainText("Manuelt");

  const now = new Date(process.env.E2E_NOW ?? "");
  now.setUTCSeconds(0, 0);
  const ts = now.toISOString();
  // The hero is the newest finger-prick, no arrow. The other viewport's run may already have typed
  // 7,4 at this same fixed minute; otherwise the newest is the last seeded one.
  const typedBefore =
    (await prisma.reading.count({ where: { spaceId: room.spaceId, ts: now } })) > 0;
  const seeded = String(SEED_ARNES_READINGS.at(-1)?.mmol).replace(".", ",");
  await expect(hero(page)).toHaveText(typedBefore ? "7,4" : seeded);
  await expect(page.locator("svg[data-trend]").filter({ visible: true })).toHaveCount(0);

  const eventsBefore = await readingEvents(room.spaceId, ts);

  await enter(page, "7,4");
  await expect(hero(page)).toHaveText("7,4");
  await expect(page.getByTestId("glucose-age").filter({ visible: true })).not.toBeEmpty();
  await expect(page.locator("svg[data-trend]").filter({ visible: true })).toHaveCount(0);
  const pill = page.getByRole("status").filter({ visible: true });
  await expect(pill).toContainText(
    desktop ? /^Manuelt · sidste måling \d{2}[:.]\d{2}$/ : "Manuelt",
  );

  const row = await prisma.reading.findMany({ where: { spaceId: room.spaceId, ts: now } });
  expect(row).toHaveLength(1);
  expect(row[0]).toMatchObject({ source: "manual", trend: "not-computable" });
  expect(Number(row[0]?.mmol)).toBe(7.4);
  expect(await readingEvents(room.spaceId, ts)).toBe(eventsBefore + 1);

  // The same value again in the same minute is the same reading: one row, not two.
  await enter(page, "7,4");
  expect(await prisma.reading.count({ where: { spaceId: room.spaceId, ts: now } })).toBe(1);
  expect(await readingEvents(room.spaceId, ts)).toBe(eventsBefore + 2);
  await expect(hero(page)).toHaveText("7,4");
});

test("Lærke cannot write a reading and receives no glucose key from /api/spaces/", async ({
  page,
}) => {
  const almas = await seededSpace();
  const room = await seededArnesRoom();
  let walked = 0;
  await page.route("**/api/spaces/**", async (route) => {
    const response = await route.fetch();
    if ((response.headers()["content-type"] ?? "").includes("json")) {
      assertMealOnly(JSON.parse(await response.text()) as unknown);
      walked++;
    }
    await route.fulfill({ response });
  });
  await registerFromInvite(page, await inviteLink("laerke"));
  await page.waitForURL(/\/da\/today$/);
  const before = await prisma.reading.count();
  const eventsBefore = await prisma.event.count();

  const denied = await page.request.post(`/api/spaces/${almas.spaceId}/readings`, {
    data: { value: 7.4, unit: "mmol" },
  });
  expect(denied.status()).toBe(403);
  assertMealOnly(await denied.json());
  // Arnes rum is not hers: a space she is not in does not exist for her.
  const other = await page.request.post(`/api/spaces/${room.spaceId}/readings`, {
    data: { value: 7.4, unit: "mmol" },
  });
  expect(other.status()).toBe(404);
  assertMealOnly(await other.json());
  const window = await page.request.get(`/api/spaces/${almas.spaceId}/readings?hours=24`);
  expect(window.status()).toBe(403);
  assertMealOnly(await window.json());

  expect(await prisma.reading.count()).toBe(before);
  expect(await prisma.event.count()).toBe(eventsBefore);
  // She did see the day: the walk covered real responses, not an empty page.
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(walked).toBeGreaterThan(0);
});
