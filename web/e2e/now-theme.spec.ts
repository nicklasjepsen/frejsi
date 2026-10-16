import path from "node:path";
import { expect, test } from "./test";
import { inviteLink, registerFromInvite } from "./support";

test("Now AI cards render in light/dark with all five accents", async ({ page }, testInfo) => {
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      await page.getByTestId("app-shell").evaluate((el, value) => {
        el.setAttribute("data-accent", value);
      }, accent);
      const card = desktop
        ? page.getByTestId("now-ai-cards")
        : page
            .getByText("Alma spurgte om et billede · Gennemgå og godkend")
            .filter({ visible: true })
            .locator("xpath=../..");
      await expect(card).toBeVisible();
      await card.evaluate((el) => {
        el.scrollIntoView({ block: "center" });
      });
      await expect(card).toHaveScreenshot(`now-${colorScheme}-${accent}.png`);
      // Also retain an overview of the edited review card in the release artifacts.
      if (desktop)
        await page
          .getByText("Alma spurgte om et billede · Gennemgå og godkend")
          .filter({ visible: true })
          .locator("xpath=../..")
          .screenshot({
            path: path.join(testInfo.outputDir, `review-${colorScheme}-${accent}.png`),
          });
    }
  }
});
