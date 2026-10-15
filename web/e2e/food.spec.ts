import { expect, test } from "./test";

import { SEED_BARCODE } from "../scripts/seed";
import { inviteLink, registerFromInvite, seededSpace } from "./support";

// Desktop only: a typed USB-scanner value uses the real lookup, services and SQL repository.
test("a carer logs the library barcode and verifies its row with V", async ({ page }) => {
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  await page
    .getByTestId("sidebar")
    .getByRole("link", { name: /Log et måltid/ })
    .click();
  await page.waitForURL(/\/da\/log$/);
  const search = page.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" });
  await search.fill(SEED_BARCODE);
  const lookup = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("barcode") === SEED_BARCODE,
  );
  await search.press("Enter");
  const lookupResponse = await lookup;
  expect(lookupResponse.status()).toBe(200);
  const results = (await lookupResponse.json()) as {
    results: { source: string; food: { name: string } }[];
  };
  expect(results.results[0]).toMatchObject({ source: "library", food: { name: "Rugbrød" } });
  const first = page.getByTestId("lookup-results").getByRole("listitem").first();
  await expect(first.getByRole("button", { name: "Rugbrød", exact: true })).toBeVisible();
  // Barcode submit adds the first match automatically; choose its portion in the meal column.
  await page.getByRole("button", { name: /^1 skive/ }).click();
  const saving = page.waitForResponse(
    (response) => response.url().endsWith("/meals") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Gem måltid/ }).click();
  expect((await saving).status()).toBe(201);
  await page.waitForURL(/\/da\/now$/);
  const table = page.getByTestId("meals-table");
  await expect(table.getByRole("link", { name: "Rugbrød", exact: true })).toBeVisible();
  await expect(table).toContainText("18 g");

  await page
    .getByTestId("sidebar")
    .getByRole("link", { name: /Bibliotek/ })
    .click();
  const row = page
    .getByTestId("library-desktop")
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "Ret Rugbrød", exact: true }) });
  await expect(row).toContainText("Ikke tjekket");
  await row.focus();
  await row.press("V");
  await expect(row.getByText("Tjekket", { exact: true })).toBeVisible();
  const space = await seededSpace();
  const response = await page.request.get(`/api/spaces/${space.spaceId}/foods?filter=all`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { foods: { name: string; verified: boolean }[] };
  expect(body.foods.find((food) => food.name === "Rugbrød")?.verified).toBe(true);
});
