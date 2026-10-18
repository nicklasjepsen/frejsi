// Settings → Pumpehistorik (v0.7.0 plan task 3): the owner connects the pump record and sees the
// status change, then disconnects it, at both widths. `source-connect` is the local stub the
// global setup starts (`SOURCE_CONNECT_URL` points at it), so nothing here talks to a real
// function or a real Nightscout; the address below is fictional and is never fetched.
import { prisma } from "@frejsi/shared";

import { SOURCE_CONNECT_STUB } from "./env";
import { inviteLink, registerFromInvite, seededSpace } from "./support";
import { expect, test } from "./test";

const ADDRESS = "https://nightscout.example.test";
const TOKEN = "e2e-fictional-token";

interface StubCall {
  purpose: string | null;
  type: string | null;
  spaceId: string | null;
}
const stubCalls = async (): Promise<StubCall[]> =>
  (await (await fetch(`${SOURCE_CONNECT_STUB}/calls`)).json()) as StubCall[];

test("Jonas connects the pump history, sees it connected, and disconnects it again", async ({
  page,
}) => {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  const { spaceId } = await seededSpace();
  const callsBefore = (await stubCalls()).length;
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto("/da/settings");

  let card;
  if (desktop) {
    card = page.getByTestId("source-section").getByTestId("pump-card");
    await expect(card.getByRole("heading", { name: "Pumpehistorik" })).toBeVisible();
  } else {
    // On the phone the card is a row in Settings, and the row opens its own page.
    const row = page.getByTestId("pump-row").filter({ visible: true });
    await expect(row).toContainText("Pumpehistorik");
    await expect(row).toContainText("Ikke forbundet");
    await row.click();
    await page.waitForURL(/\/da\/settings\/pump$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pumpehistorik");
    card = page.getByTestId("pump-page").getByTestId("pump-card");
  }
  await expect(card.getByTestId("pump-status")).toHaveText("Ikke forbundet");

  await card.getByRole("button", { name: "Forbind" }).click();
  const form = card.getByTestId("pump-form");
  await form.getByLabel("Adresse på din Nightscout-side").fill(ADDRESS);
  await form.locator('input[name="secret"]').fill(TOKEN);
  await form.getByRole("button", { name: "Forbind" }).click();

  await expect(card.getByTestId("pump-status")).toHaveText("Forbundet");
  await expect(card.getByTestId("pump-latest")).toHaveText("Intet fra pumpen endnu");
  // The stub answers no boluses for the last day: the card says what to check.
  await expect(card.getByTestId("pump-no-recent")).toContainText("Adgangen virker");
  await expect(form).toHaveCount(0);

  // The connect went to the stub, as a pump connect for this space, and only once.
  const calls = (await stubCalls()).slice(callsBefore);
  expect(calls).toEqual([{ purpose: "pump", type: "nightscout", spaceId }]);
  // Only the reference is stored; the address and the token are nowhere in the row.
  const row = await prisma.space.findUniqueOrThrow({ where: { id: spaceId } });
  expect(row.pumpStatus).toBe("connected");
  expect(JSON.parse(row.pumpSource ?? "null")).toMatchObject({
    type: "nightscout",
    secretRef: `pump-${spaceId}/e2e0fictional`,
  });
  expect(JSON.stringify(row)).not.toContain("nightscout.example.test");
  expect(JSON.stringify(row)).not.toContain(TOKEN);

  // The status comes back from the server after a reload, not only from the form's answer.
  await page.reload();
  const again = desktop
    ? page.getByTestId("source-section").getByTestId("pump-card")
    : page.getByTestId("pump-page").getByTestId("pump-card");
  await expect(again.getByTestId("pump-status")).toHaveText("Forbundet");

  // Disconnecting leaves the space as the seed made it, for the other width's run.
  await again.getByRole("button", { name: "Afbryd" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Ja, afbryd" }).click();
  await expect(again.getByTestId("pump-status")).toHaveText("Ikke forbundet");
  const after = await prisma.space.findUniqueOrThrow({ where: { id: spaceId } });
  expect(after.pumpSource).toBeNull();
  expect(after.pumpStatus).toBe("not-configured");
});
