// A dish from a recipe (v0.6.0 §6): pasted text against the fake provider, the review form, "Gem"
// into the library as an unverified dish of origin recipe; "Gem som opskrift" from a logged meal;
// and the share receiver, driven directly (the share sheet itself is a phone, decision 13.5).
import { prisma } from "@frejsi/shared";
import { SEED_DISH } from "../scripts/seed";
import { inviteLink, registerFromInvite, seededSpace } from "./support";
import { expect, test } from "./test";

test.use({ serviceWorkers: "block" });

test("Jonas pastes a recipe, corrects a match, saves the dish unverified and edits it again", async ({
  page,
}) => {
  const { spaceId } = await seededSpace();
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto("/da/log");
  // The manual path's way in: the row after "Jeg kender tallet selv". One SearchField at both
  // widths (type="search"), named for the phone and for the desktop.
  const search = page
    .getByRole("searchbox", { name: /Skriv hvad der spises|Søg mad eller skriv en stregkode/ })
    .filter({ visible: true });
  await search.fill("lasagne");
  await search.press("Enter");
  await page.getByTestId("from-recipe").filter({ visible: true }).click();
  await page.waitForURL(/\/da\/recipe\/new$/);
  await expect(page.getByRole("heading", { name: "Ny ret fra opskrift" })).toBeVisible();

  const parsing = page.waitForResponse(
    (r) => r.url().endsWith("/recipes/parse") && r.request().method() === "POST",
  );
  await page
    .getByRole("textbox", { name: "Ingredienser" })
    .fill("200 g example pasta, 2 pærer, 5 dl vand");
  await page.getByRole("button", { name: "Læs ingredienserne", exact: true }).click();
  expect((await parsing).status()).toBe(200);
  const rows = page.getByTestId("ingredient-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("ca.");
  await expect(rows.nth(2)).toContainText("Uden kulhydrat");
  // Nothing matched "Example pasta" in the seeded library: change the match by search.
  await rows.first().getByRole("button", { name: "Skift", exact: true }).click();
  await rows
    .first()
    .getByRole("textbox", { name: /Søg efter en vare/ })
    .fill("Rugbrød");
  await rows.first().getByRole("button", { name: "Søg", exact: true }).click();
  await rows.first().getByRole("button", { name: "Vælg Rugbrød", exact: true }).click();
  await expect(rows.first()).toContainText("Fundet som Rugbrød");
  await expect(rows.first()).toContainText("80 g"); // 200 g at 40 g per 100 g
  await expect(rows.first()).not.toContainText("ca.");
  // Nothing is saved before the tap: only the seed's own recipe dish is there.
  expect(await prisma.food.count({ where: { spaceId, origin: "recipe" } })).toBe(1);

  await page.getByRole("textbox", { name: "Rettens navn" }).fill("Eksempelgryde");
  const saving = page.waitForResponse(
    (r) => r.url().endsWith("/recipes") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Gem", exact: true }).click();
  expect((await saving).status()).toBe(201);
  // The shell has a status region of its own: the one with the saved message.
  await expect(page.getByRole("status").filter({ hasText: "Gemt i biblioteket" })).toBeVisible();
  const dish = await prisma.food.findFirstOrThrow({ where: { spaceId, name: "Eksempelgryde" } });
  try {
    expect(dish).toMatchObject({ origin: "recipe", verified: false });
    const recipe = JSON.parse(dish.recipe ?? "null") as {
      source: { kind: string };
      yieldPortions: number;
    };
    expect(recipe.source.kind).toBe("text");
    expect(recipe.yieldPortions).toBe(4);
    await page.getByRole("link", { name: "Se den i biblioteket" }).click();
    await page.waitForURL(new RegExp(`/da/library/${dish.id}$`));

    // Editing a line recalculates the dish and leaves the library row unverified.
    await page.goto(`/da/recipe/${dish.id}`);
    await expect(page.getByRole("heading", { name: "Ret opskriften" })).toBeVisible();
    await page.getByRole("spinbutton", { name: "Portioner" }).fill("2");
    const patching = page.waitForResponse(
      (r) => r.url().endsWith(`/recipes/${dish.id}`) && r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Gem", exact: true }).click();
    expect((await patching).status()).toBe(200);
    const updated = await prisma.food.findUniqueOrThrow({ where: { id: dish.id } });
    expect(updated.verified).toBe(false);
    expect((JSON.parse(updated.portions) as { label: string; carbs: number }[])[0]).toMatchObject({
      label: "1 portion",
      carbs: 40,
    });
  } finally {
    expect((await page.request.delete(`/api/spaces/${spaceId}/foods/${dish.id}`)).ok()).toBe(true);
  }
});

test("Gem som opskrift opens a logged meal as lines, and the share receiver hands a share out once", async ({
  page,
}) => {
  const { spaceId } = await seededSpace();
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  // The seed's last meal is the dish of the meal-detail flow.
  const meal = await prisma.meal.findFirstOrThrow({ where: { spaceId }, orderBy: { ts: "desc" } });
  await page.goto(`/da/recipe/new?meal=${meal.id}`);
  await expect(page.getByRole("textbox", { name: "Rettens navn" })).toHaveValue(SEED_DISH);
  await expect(page.getByText("Fra et måltid", { exact: true })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Portioner" })).toHaveValue("1");
  await expect(page.getByTestId("ingredient-row")).toHaveCount(2);
  await expect(page.getByText("ca.", { exact: true })).toHaveCount(0);

  const shared = await page.request.post("/api/share", {
    multipart: { title: "Delt opskrift", text: "500 g hakket oksekød\n2 dåser flåede tomater" },
    maxRedirects: 0,
  });
  expect(shared.status()).toBe(303);
  const location = shared.headers().location ?? "";
  expect(location).toMatch(/\/da\/recipe\/new\?share=[0-9a-f-]{36}$/);
  await page.goto(location);
  await expect(page.getByRole("textbox", { name: "Ingredienser" })).toHaveValue(
    "500 g hakket oksekød\n2 dåser flåede tomater",
  );
  await expect(page.getByText("Delt fra en anden app", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Det delte indhold er udløbet" }),
  ).toBeVisible();

  // A signed-out share goes to welcome and keeps nothing.
  const anonymous = await page.context().browser()?.newContext();
  if (!anonymous) throw new Error("no browser");
  try {
    const refused = await anonymous.request.post("/api/share", {
      multipart: { text: "x" },
      maxRedirects: 0,
    });
    expect(refused.status()).toBe(303);
    expect(refused.headers().location).toMatch(/\/da\/welcome$/);
  } finally {
    await anonymous.close();
  }
});
