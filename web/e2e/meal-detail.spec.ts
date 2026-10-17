import { prisma } from "@frejsi/shared";
import { expect, test } from "./test";
import { SEED_DISH } from "../scripts/seed";
import { inviteLink, registerFromInvite, seededSpace } from "./support";

test("the last meal shows its curve and previous dishes, edits portions and deletes", async ({
  page,
}) => {
  const { spaceId } = await seededSpace();
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  if (desktop) {
    await page
      .getByTestId("meals-table")
      .getByRole("link", { name: "Rugbrød med ost og Æble", exact: true })
      .click();
  } else {
    await page
      .getByTestId("last-meal")
      .getByTestId("meal-card")
      .getByRole("link", { name: /Rugbrød/ })
      .click();
  }
  await page.waitForURL(/\/da\/meal\//);
  const mealId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const original = (await (
    await page.request.get(`/api/spaces/${spaceId}/meals/${mealId}`)
  ).json()) as { ts: string; bolusTs: string; note: string; items: { name: string }[] };
  const curve = page.getByTestId("curve-card");
  await expect(page.getByRole("heading", { name: SEED_DISH, exact: true })).toBeVisible();
  await expect(curve.getByText("−1 t", { exact: true })).toBeVisible();
  await expect(curve.getByText("+4 t", { exact: true })).toBeVisible();
  await expect(curve.getByRole("img")).toHaveAttribute("aria-label", /Bolus 11:58/);
  await expect(curve.getByTestId("previous")).toHaveCount(desktop ? 4 : 3);
  await expect(page.getByTestId("meal-tiles")).toContainText("Top");
  await expect(page.getByTestId("meal-tiles")).toContainText("efter");
  if (desktop) {
    await expect(page.getByRole("radio", { name: "Sammen med de sidste 4 gange" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const table = page.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(6); // header, current, four earlier
    await page.getByRole("radio", { name: "Kun denne gang" }).click();
    await expect(table).toHaveCount(0);
    await expect(curve.getByTestId("previous")).toHaveCount(0);
    await page.getByRole("radio", { name: "Sammen med de sidste 4 gange" }).click();
  } else {
    await expect(curve.getByText("Bolus 11:58", { exact: true })).toBeVisible();
  }
  const { lastSeq: beforeEdit } = await prisma.space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { lastSeq: true },
  });
  const updatedTitle = `${SEED_DISH} · mindre æble`;
  try {
    await page.getByRole("button", { name: /^Ret(?: måltid| E)$/ }).click();
    const sheet = page.getByRole("dialog", { name: "Ret måltid" });
    await sheet.getByRole("button", { name: /^½ mellem/ }).click();
    await sheet.getByRole("textbox", { name: "Note" }).fill(updatedTitle);
    await sheet.getByRole("button", { name: "Gem", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("heading", { name: updatedTitle, exact: true })).toBeVisible();
    if (desktop) {
      await expect(page.getByTestId("meal-items").locator('[data-total="true"]')).toHaveText(
        /I alt\s*43 g/,
      );
    } else {
      await expect(page.getByText("43 g kulhydrat · 2 ting", { exact: true })).toBeVisible();
    }
    await expect
      .poll(async () => {
        const events = await prisma.event.findMany({
          where: { spaceId, type: "meal.updated", seq: { gt: beforeEdit } },
        });
        return events.some(
          (event) => (JSON.parse(event.payload) as { mealId: string }).mealId === mealId,
        );
      })
      .toBe(true);
    await page.getByRole("button", { name: /^Ret(?: måltid| E)$/ }).click();
    await page.getByRole("button", { name: "Fjern bolustidspunkt", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Gem", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(curve.getByTestId("bolus")).toHaveCount(0);
    const cleared = await page.request.get(`/api/spaces/${spaceId}/meals/${mealId}`);
    expect(await cleared.json()).not.toHaveProperty("bolusTs");
    await page.reload();
    await expect(page.getByRole("heading", { name: updatedTitle, exact: true })).toBeVisible();
    await expect(page.getByTestId("curve-card").getByTestId("bolus")).toHaveCount(0);
  } finally {
    // Keep the baseline intact for the other viewport and the viewer's original total assertions.
    const apple = await prisma.food.findFirstOrThrow({ where: { spaceId, name: "Æble" } });
    const bread = await prisma.food.findFirstOrThrow({
      where: { spaceId, name: "Rugbrød med ost" },
    });
    expect(
      (
        await page.request.patch(`/api/spaces/${spaceId}/meals/${mealId}`, {
          data: {
            ts: original.ts,
            note: original.note,
            bolusTs: original.bolusTs,
            items: [
              { foodId: bread.id, name: bread.name, portionLabel: "2 skiver" },
              { foodId: apple.id, name: apple.name, portionLabel: "1 mellem" },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
  }
  // Delete an earlier seeded occurrence and recreate it through the real API afterwards.
  const earlier = await prisma.meal.findFirstOrThrow({
    where: { spaceId },
    orderBy: { ts: "asc" },
    include: { items: { orderBy: { position: "asc" } } },
  });
  await page.goto(`/da/meal/${earlier.id}`);
  await page.getByRole("button", { name: /^Ret(?: måltid| E)$/ }).click();
  const sheet = page.getByRole("dialog", { name: "Ret måltid" });
  await sheet.getByRole("button", { name: "Slet måltid", exact: true }).click();
  await expect(sheet).toContainText("Slet måltidet? Det kan ikke fortrydes.");
  await sheet.getByRole("button", { name: "Ja, slet", exact: true }).click();
  try {
    await page.waitForURL(/\/da\/now$/);
    expect((await page.request.get(`/api/spaces/${spaceId}/meals/${earlier.id}`)).status()).toBe(
      404,
    );
    await expect(page.locator(`a[href$="/meal/${earlier.id}"]`)).toHaveCount(0);
  } finally {
    expect(
      (
        await page.request.post(`/api/spaces/${spaceId}/meals`, {
          data: {
            ts: earlier.ts.toISOString(),
            note: earlier.note,
            bolusTs: earlier.bolusTs?.toISOString(),
            items: earlier.items.map((item) => ({
              foodId: item.foodId,
              name: item.name,
              portionLabel: item.portionLabel,
              carbs: item.carbs,
            })),
          },
        })
      ).status(),
    ).toBe(201);
  }
});

test("simpleMode opens the last meal's items and total without curve or editing", async ({
  page,
}) => {
  await registerFromInvite(page, await inviteLink("alma"));
  await page.waitForURL(/\/da\/now$/);
  await page.getByRole("link").filter({ hasText: "Du spiste kl." }).click();
  const meal = page.getByTestId("simple-meal");
  await expect(meal.getByRole("heading", { name: "Du spiste kl. 12:10" })).toBeVisible();
  await expect(meal).toContainText(SEED_DISH);
  await expect(meal).toContainText("Æble");
  await expect(meal).toContainText("50 g kulhydrat");
  await expect(meal.getByRole("listitem")).toHaveCount(2);
  await expect(meal.getByTestId("curve")).toHaveCount(0);
  await expect(meal.getByRole("button", { name: /^Ret/ })).toHaveCount(0);
});

// The owner's request of 2026-10-17 (v0.6.0 task 8): a logged meal is edited from where it is
// shown. On the phone the Now card's "Ret" opens the detail with the sheet already open; on
// desktop the same address does. A second tab on Now sees the change through the live feed.
test("edits a logged meal from the Now row and sees the change on Now and in the day", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { spaceId } = await seededSpace();
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  const now = new Date(process.env.E2E_NOW ?? "");
  const bread = await prisma.food.findFirstOrThrow({ where: { spaceId, name: "Rugbrød med ost" } });
  const apple = await prisma.food.findFirstOrThrow({ where: { spaceId, name: "Æble" } });
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const title = "Eftermiddagsmad til e2e";
  const logged = await page.request.post(`/api/spaces/${spaceId}/meals`, {
    data: {
      ts: new Date(now.getTime() - 40 * 60_000).toISOString(), // 14:33, the newest meal
      note: title,
      items: [
        { foodId: bread.id, name: bread.name, portionLabel: "2 skiver" },
        { foodId: apple.id, name: apple.name, portionLabel: "1 mellem" },
      ],
    },
  });
  expect(logged.status()).toBe(201);
  const { id: mealId } = (await logged.json()) as { id: string };
  const watcher = await page.context().newPage();
  try {
    await watcher.clock.setFixedTime(now);
    await watcher.goto("/da/now");
    await expect(watcher.getByTestId(desktop ? "meals-table" : "last-meal")).toContainText("50 g");
    if (desktop) {
      await page.goto(`/da/meal/${mealId}?edit=1`);
    } else {
      const card = page.getByTestId("last-meal").getByTestId("meal-card");
      await expect(card).toContainText("14:33 · 50 g kulhydrat · Jonas");
      const edit = card.getByRole("link", { name: "Ret måltidet kl. 14:33" });
      await expect(edit).toHaveAttribute("href", `/da/meal/${mealId}?edit=1`);
      await edit.click();
    }
    await page.waitForURL(new RegExp(`/da/meal/${mealId}\\?edit=1$`));
    const sheet = page.getByRole("dialog", { name: "Ret måltid" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /^½ mellem/ }).click();
    await sheet.getByLabel("Tidspunkt").fill("14:45");
    await expect(sheet.getByTestId("total-bar")).toContainText("43 g");
    await sheet.getByRole("button", { name: "Gem", exact: true }).click();
    await expect(sheet.getByTestId("sheet-saved")).toHaveText("Gemt");
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/da/meal/${mealId}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    if (desktop) {
      await expect(page.getByTestId("meal-items").locator('[data-total="true"]')).toHaveText(
        /I alt\s*43 g/,
      );
      await expect(page.getByText(/· 14:45 · logget af Jonas/)).toBeVisible();
    } else {
      await expect(page.getByText("43 g kulhydrat · 2 ting", { exact: true })).toBeVisible();
      await expect(page.getByText("I dag 14:45 · Jonas", { exact: true })).toBeVisible();
    }
    // The other tab was never reloaded: the feed brings the edit within its poll interval.
    await expect(watcher.getByTestId(desktop ? "meals-table" : "last-meal")).toContainText(
      desktop ? "14:45" : "14:45 · 43 g kulhydrat · Jonas",
      { timeout: 45_000 },
    );
    if (desktop) await expect(watcher.getByTestId("meals-table")).toContainText("43 g");
    await page.goto("/da/history");
    if (desktop) await page.getByRole("radio", { name: "Dag", exact: true }).click();
    // The day names a meal by its items, not its note: the row is the one at the new time.
    const row = page
      .getByTestId("history-day")
      .first()
      .getByTestId("meal-card")
      .filter({ hasText: "14:45" });
    await expect(row).toContainText("Rugbrød med ost og Æble");
    await expect(row).toContainText("43 g");
    await expect(row.getByRole("link", { name: "Ret måltidet kl. 14:45" })).toHaveAttribute(
      "href",
      `/da/meal/${mealId}?edit=1`,
    );
  } finally {
    await watcher.close();
    // The seeded day keeps its three meals for the specs that follow.
    expect((await page.request.delete(`/api/spaces/${spaceId}/meals/${mealId}`)).ok()).toBe(true);
  }
});
