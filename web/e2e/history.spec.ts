import { expect, test } from "./test";
import { inviteLink, registerFromInvite } from "./support";

test("History opens today's day on phone and the seven-day week on desktop", async ({ page }) => {
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  const nav = page.getByTestId(desktop ? "sidebar" : "phone-tabs");
  await nav.getByRole("link", { name: /^Historik/ }).click();
  if (desktop) {
    await page.waitForURL(/\/da\/history\/week$/);
    await expect(page.getByRole("region", { name: "Ugens dage" }).getByRole("link")).toHaveCount(7);
    await expect(page.getByRole("heading", { name: "Ugens tal" })).toBeVisible();
    await expect(page.getByText("I mål 4–10", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Dag", exact: true }).click();
  }
  await page.waitForURL(/\/da\/history(?:\?.*)?$/);
  const today = page.getByTestId("history-day").first();
  await expect(
    today.getByRole("img", { name: /^Glukose i dag med måltider markeret/ }),
  ).toBeVisible();
  await expect(today).toContainText("I mål 4–10:");
  await expect(today.getByTestId("meal-card")).toHaveCount(3);
  for (const card of await today.getByTestId("meal-card").all()) {
    await expect(card).toContainText("top");
    await expect(card).toContainText("efter");
  }
  // "Symptomer" (v0.6.0 plan §5): the day's list becomes the symptom rows; none are seeded yet.
  const chip = page.getByRole("button", { name: "Symptomer" }).first();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(today.getByTestId("meal-card")).toHaveCount(0);
  await expect(today).toContainText("Ingen symptomer denne dag");
  await chip.click();
  await expect(today.getByTestId("meal-card")).toHaveCount(3);
});
