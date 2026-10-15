// simpleMode (plan §8, task 10): Alma, a carer with simpleMode on, opens an add-a-device link,
// creates a passkey and lands on Nu with her number, its trend and its age, in the three-tab
// shell. Runs at 360 px (phone) and 1280 px (desktop).
import { expect, test } from "./test";

import { inviteLink, navLabels, registerFromInvite, seededSpace } from "./support";

test("a passkey from an invite opens the simpleMode Now screen with number, arrow and age", async ({
  page,
}) => {
  await registerFromInvite(page, await inviteLink("alma"));
  await page.waitForURL(/\/da\/now$/);

  const now = page.getByTestId("now-simple");
  await expect(now).toBeVisible();
  await expect(now.getByTestId("glucose-number")).toHaveText(/^\d{1,2},\d$/);
  const arrow = now.locator("svg[data-trend]");
  await expect(arrow).toBeVisible();
  await expect(arrow).toHaveAttribute("aria-label", /\S/);
  // The seed's newest reading is at most five minutes old when the run starts.
  await expect(now.getByTestId("glucose-age")).toHaveText(
    /^(lige nu|for \d+ min\. siden)( · .+)?$/,
  );

  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-variant", "simple");
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  expect(await navLabels(page)).toEqual(["Nu", "Min mad", desktop ? "Spørg en voksen" : "Spørg"]);
});

test("the verified picker saves Min madpakke and Now shows the meal and its time", async ({
  page,
}) => {
  await registerFromInvite(page, await inviteLink("alma"));
  await page.waitForURL(/\/da\/now$/);
  await page.getByRole("link", { name: "Jeg spiser nu", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hvad spiser du?" })).toBeVisible();
  await expect(page.getByTestId("eat-loading")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rugbrød", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Kartoffel kogt", exact: true })).toHaveCount(0);
  const { spaceId } = await seededSpace();
  const library = await page.request.get(`/api/spaces/${spaceId}/foods?filter=all`);
  expect(library.status()).toBe(200);
  const visible = (await library.json()) as { foods: { verified: boolean }[] };
  expect(visible.foods).toHaveLength(7);
  expect(visible.foods.every((food) => food.verified)).toBe(true);
  await page.getByRole("button", { name: /Min madpakke/ }).click();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/meals") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ja, det spiser jeg" }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON() as object).not.toHaveProperty("bolusTs");
  const meal = (await response.json()) as { id: string; ts: string };
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(meal.ts));
  try {
    await page.waitForURL(/\/da\/now$/);
    const card = page.getByTestId("now-simple").getByTestId("meal-card");
    await expect(card).toContainText(`Du spiste kl. ${time}`);
    await expect(card).toContainText("Min madpakke");
  } finally {
    expect((await page.request.delete(`/api/spaces/${spaceId}/meals/${meal.id}`)).ok()).toBe(true);
  }
});
