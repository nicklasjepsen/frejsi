// Settings → Glukosekilde (v0.5.0 spec §6, §3b): the three source cards with the current one
// selected, the vault notice, and the Nightscout form. Nothing is submitted: the e2e runs no poller
// and contacts no Nightscout.
import { expect, test } from "./test";

import { inviteLink, registerFromInvite } from "./support";

test("Jonas sees the three sources, the vault notice and the Nightscout form", async ({ page }) => {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto("/da/settings");

  if (desktop) {
    const section = page.getByTestId("source-section");
    await expect(section.getByRole("heading", { name: "Glukosekilde" })).toBeVisible();
    const cards = section.locator('[data-testid^="source-card"]');
    await expect(cards).toHaveCount(3);
    const selected = section.getByTestId("source-card");
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute("data-selected", "true");
    await expect(selected).toContainText("Dexcom Share");
    await expect(section).toContainText("Login til Dexcom Share gemmes i et låst hvælv");
    await expect(section.getByTestId("source-card-nightscout")).toContainText("Nightscout");
    await expect(section.getByTestId("source-card-manual")).toContainText("Manuelt");
    await section
      .getByTestId("source-card-nightscout")
      .getByRole("link", { name: "Forbind" })
      .click();
  } else {
    // On the phone the section is a row, and the row opens the picker.
    const row = page.getByTestId("source-row").filter({ visible: true });
    await expect(row).toContainText("Dexcom Share");
    await row.click();
    await page.waitForURL(/\/da\/settings\/source$/);
    const picker = page.getByTestId("source-picker");
    await expect(picker.locator('[data-layout="radio"][data-testid^="source-card"]')).toHaveCount(
      3,
    );
    await expect(picker.getByTestId("source-card")).toContainText("Dexcom Share");
    await expect(picker).toContainText("Login til Dexcom Share gemmes i et låst hvælv");
    await picker
      .getByTestId("source-card-nightscout")
      .getByRole("link", { name: "Forbind" })
      .click();
  }

  await page.waitForURL(/\/da\/settings\/source\/connect\?type=nightscout$/);
  const form = page.getByTestId("connect-source");
  await expect(form.getByLabel("Adresse på din Nightscout-side")).toBeVisible();
  // The token or the API secret, one control for the two; the token is the default.
  // The label spells the header's name, which only shared/ may write out: match it loosely.
  const apiSecret = new RegExp("^API.secret$");
  const kind = form.getByRole("radiogroup", { name: new RegExp("^Adgangstoken · API.secret$") });
  await expect(kind.getByRole("radio", { name: "Adgangstoken" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(form.getByLabel("Adgangstoken", { exact: true })).toBeVisible();
  await kind.getByRole("radio", { name: apiSecret }).click();
  await expect(form.getByLabel(apiSecret)).toBeVisible();
});
