// "Ny fødevare" on the phone (issue 219): the library's own create form, end to end against the
// real routes and SQL repository. A food saved here is back in the list on return without a
// reload; a number the contract cannot store is stopped in the form, before any request.
import type { Page, Request } from "@playwright/test";

import { inviteLink, registerFromInvite } from "./support";
import { expect, test } from "./test";

test.use({ serviceWorkers: "block", hasTouch: true, isMobile: true });

test.beforeEach(() => {
  test.skip(test.info().project.name !== "phone", "The phone's own page for a new food");
});

/** Every POST to the space's foods route the page sends from now on. */
function foodPosts(page: Page): Request[] {
  const posts: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/spaces\/[^/]+\/foods$/.test(request.url()))
      posts.push(request);
  });
  return posts;
}

async function openNewFood(page: Page): Promise<void> {
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto("/da/library");
  await page.getByRole("link", { name: "Ny fødevare", exact: true }).click();
  await page.waitForURL(/\/da\/library\/new$/);
  await expect(page.getByRole("heading", { name: "Ny fødevare" })).toBeVisible();
}

test("a carer saves a new food on the phone and finds it in the list on return", async ({
  page,
}) => {
  const posts = foodPosts(page);
  await openNewFood(page);
  await page.getByRole("textbox", { name: "Navn", exact: true }).fill("Eksempelbolle");
  await page.getByRole("textbox", { name: "Kulhydrat pr. 100 g" }).fill("40,5");
  const row = page.getByTestId("portion-row").first();
  await row.getByRole("textbox", { name: "Portion", exact: true }).fill("1 bolle");
  await row.getByRole("textbox", { name: "g", exact: true }).fill("60,5");
  await expect(row).toContainText("25 g kulhydrat");

  const saving = page.waitForResponse(
    (response) =>
      /\/api\/spaces\/[^/]+\/foods$/.test(response.url()) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Gem", exact: true }).tap();
  expect((await saving).status()).toBe(201);
  expect(posts).toHaveLength(1);
  // One decimal as typed; "Gem" never asks for the tick, so the food stays unverified.
  const body = posts[0]?.postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({
    carbsPer100g: 40.5,
    portions: [{ label: "1 bolle", grams: 60.5, carbs: 25 }],
  });
  expect(body).not.toHaveProperty("verified");
  expect(body).not.toHaveProperty("verify");

  await page.waitForURL(/\/da\/library$/);
  await expect(page.getByRole("link", { name: /Eksempelbolle/ })).toBeVisible();
});

test("a number with two decimals is stopped in the form and nothing is sent", async ({ page }) => {
  const posts = foodPosts(page);
  await openNewFood(page);
  await page.getByRole("textbox", { name: "Navn", exact: true }).fill("Eksempelkiks");
  await page.getByRole("textbox", { name: "Kulhydrat pr. 100 g" }).fill("12,34");
  await page.getByRole("button", { name: "Gem", exact: true }).tap();
  await expect(page.getByTestId("food-edit").getByRole("alert")).toHaveText(
    "Skriv tallet med højst én decimal, fx 12,3.",
  );
  await expect(page.getByText("Kunne ikke gemme")).toHaveCount(0);
  expect(posts).toHaveLength(0);
  await expect(page).toHaveURL(/\/da\/library\/new$/);
});
