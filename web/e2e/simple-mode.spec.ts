// simpleMode (plan §8, task 10): Alma, a carer with simpleMode on, opens an add-a-device link,
// creates a passkey and lands on Nu with her number, its trend and its age, in the three-tab
// shell. Runs at 360 px (phone) and 1280 px (desktop).
import { expect, test } from "@playwright/test";

import { inviteLink, navLabels, registerFromInvite } from "./support";

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
