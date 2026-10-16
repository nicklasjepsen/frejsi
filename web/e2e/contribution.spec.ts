// "Send rettelsen til Open Food Facts" (spec §4): a carer ticks the box on an OFF food, the send
// is recorded as `food.contributed`, and nothing goes out without the tick. The contributor is the
// local fake (`FAKE_FOOD_CONTRIBUTOR=1`), so Open Food Facts is never contacted. A viewer is refused.
import { prisma } from "@frejsi/shared";
import { expect, test } from "./test";

import { inviteLink, registerFromInvite, seededSpace } from "./support";

async function contributed(spaceId: string, foodId: string): Promise<number> {
  const events = await prisma.event.findMany({ where: { spaceId, type: "food.contributed" } });
  return events.filter(
    (event) => (JSON.parse(event.payload) as { foodId: string }).foodId === foodId,
  ).length;
}

test("Jonas sends a correction only when he ticks the box", async ({ page }) => {
  const space = await seededSpace();
  const rugbroed = await prisma.food.findFirstOrThrow({
    where: { spaceId: space.spaceId, name: "Rugbrød" },
  });
  const kartoffel = await prisma.food.findFirstOrThrow({
    where: { spaceId: space.spaceId, name: "Kartoffel kogt" },
  });
  const before = await contributed(space.spaceId, rugbroed.id);

  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const openLibrary = async () => {
    await page.goto("/da/library");
    await page.getByTestId("library-desktop").waitFor();
  };
  const edit = async (name: string) => {
    const available = page.waitForResponse(
      (response) =>
        response.url().endsWith("/contributions") && response.request().method() === "GET",
    );
    await page.getByRole("button", { name: `Ret ${name}`, exact: true }).click();
    await available;
    await expect(page.getByLabel("Navn", { exact: true })).toHaveValue(name);
  };
  const box = page.getByRole("checkbox", { name: /^Send rettelsen til Open Food Facts/ });

  await openLibrary();
  await edit("Rugbrød");
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByRole("button", { name: "Gem", exact: true }).click();
  await expect(page.getByTestId("contribution-outcome")).toHaveText(
    "Sendt til Open Food Facts · tak",
  );
  expect(await contributed(space.spaceId, rugbroed.id)).toBe(before + 1);

  // Again, without the tick: saved, nothing sent. The box is never remembered.
  await openLibrary();
  await edit("Rugbrød");
  await expect(box).not.toBeChecked();
  const saved = page.waitForResponse(
    (response) => response.url().includes("/foods/") && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Gem", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByTestId("contribution-outcome")).toHaveCount(0);
  expect(await contributed(space.spaceId, rugbroed.id)).toBe(before + 1);

  // A Frida food has no source to send to: no box.
  await openLibrary();
  await edit("Kartoffel kogt");
  await expect(box).toHaveCount(0);
  expect(await contributed(space.spaceId, kartoffel.id)).toBe(0);
});

test("Lærke is refused on both contributions routes", async ({ page }) => {
  const space = await seededSpace();
  const food = await prisma.food.findFirstOrThrow({
    where: { spaceId: space.spaceId, name: "Rugbrød" },
  });
  await registerFromInvite(page, await inviteLink("laerke"));
  await page.waitForURL(/\/da\/today$/);
  const before = await prisma.event.count({ where: { spaceId: space.spaceId } });
  const get = await page.request.get(`/api/spaces/${space.spaceId}/contributions`);
  expect(get.status()).toBe(403);
  const post = await page.request.post(`/api/spaces/${space.spaceId}/contributions`, {
    data: { foodId: food.id },
  });
  expect(post.status()).toBe(403);
  expect(await prisma.event.count({ where: { spaceId: space.spaceId } })).toBe(before);
});
