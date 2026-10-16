import { expect, test } from "./test";
import { inviteLink, registerFromInvite } from "./support";

// The Now AI cards in light and dark with every accent. The check is on computed styles, not on
// pixel snapshots: a runner's font rasteriser differs from a workstation's by a few pixels, which
// is no finding. The screenshots are kept as release artifacts for a human eye.
test("Now AI cards render in light/dark with all five accents", async ({ page }, testInfo) => {
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  const seen: Record<"light" | "dark", Map<string, string>> = {
    light: new Map(),
    dark: new Map(),
  };
  const surfaces: Record<"light" | "dark", Set<string>> = { light: new Set(), dark: new Set() };
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
      const style = await card.evaluate((el) => {
        const computed = getComputedStyle(el);
        return {
          accent: computed.getPropertyValue("--accent-base").trim(),
          surface: computed.getPropertyValue("--surface").trim(),
          text: computed.color,
        };
      });
      // The accent resolves to a colour, and each accent to its own.
      expect(style.accent, `${colorScheme} ${accent} accent`).not.toBe("");
      seen[colorScheme].set(accent, style.accent);
      // Text stays readable: the surface and the text are never the same colour.
      expect(style.text, `${colorScheme} ${accent} text`).not.toBe(style.surface);
      surfaces[colorScheme].add(style.surface);
      await card.screenshot({ path: testInfo.outputPath(`now-${colorScheme}-${accent}.png`) });
      // Also retain an overview of the edited review card in the release artifacts.
      if (desktop)
        await page
          .getByText("Alma spurgte om et billede · Gennemgå og godkend")
          .filter({ visible: true })
          .locator("xpath=../..")
          .screenshot({ path: testInfo.outputPath(`review-${colorScheme}-${accent}.png`) });
    }
    expect(new Set(seen[colorScheme].values()).size, `${colorScheme} accents distinct`).toBe(5);
  }
  // Dark mode draws the card on another surface than light mode does.
  for (const surface of surfaces.light) expect(surfaces.dark.has(surface)).toBe(false);
});
