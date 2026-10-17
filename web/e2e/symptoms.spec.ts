// Symptoms (v0.6.0 plan §5, task 3): two taps on the phone log how Jonas feels, "Fortryd" takes it
// back, a second open screen hears the entry through the feed (the polling fallback here: no Web
// PubSub in this run), "Mere…" adds severity and a note, and Alma's simpleMode picker is tiles
// only. Runs at 360 px (phone) and 1280 px (desktop); the push itself is unit-tested on the sink.
import { prisma } from "@frejsi/shared";

import { assertMealOnly, inviteLink, navLabels, registerFromInvite, seededSpace } from "./support";
import { expect, test } from "./test";

test.use({ serviceWorkers: "block" });

const KINDS = ["Ondt i maven", "Svimmel", "Kvalme", "Træt", "Hovedpine", "Rysten"];

test("one tap logs the kind at now, a second screen sees it, and Fortryd removes it", async ({
  page,
  browser,
}) => {
  const space = await seededSpace();
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  if (desktop) {
    expect(await navLabels(page)).toContain("Jeg har det…");
    await page.getByTestId("sidebar").getByRole("link", { name: "Jeg har det…" }).click();
  } else {
    await page.goto("/da/feel");
  }
  await page.waitForURL(/\/da\/feel$/);
  const grid = page.getByTestId("feel-grid");
  for (const name of KINDS)
    await expect(grid.getByRole("button", { name, exact: true })).toBeVisible();

  const otherContext = await browser.newContext({
    viewport: page.viewportSize(),
    locale: "da-DK",
    timezoneId: "Europe/Copenhagen",
  });
  const other = await otherContext.newPage();
  await other.clock.setFixedTime(new Date(process.env.E2E_NOW ?? ""));
  let symptomId: string | null = null;
  try {
    await registerFromInvite(other, await inviteLink("birthe"));
    await other.waitForURL(/\/da\/now$/);
    await other.goto("/da/feel");
    await expect(other.getByTestId("feel-today")).toContainText("Intet logget i dag");

    const saving = page.waitForResponse(
      (r) => r.url().endsWith("/symptoms") && r.request().method() === "POST",
    );
    await grid.getByRole("button", { name: "Ondt i maven", exact: true }).click();
    const response = await saving;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toEqual({ kind: "stomach-ache" });
    const saved = (await response.json()) as { id: string; ts: string; kind: string };
    symptomId = saved.id;
    expect(saved.kind).toBe("stomach-ache");
    const status = page.getByTestId("feel-status");
    await expect(status).toContainText("Ondt i maven er logget");
    await expect(status.getByRole("button", { name: "Fortryd" })).toBeVisible();
    await expect(page.getByTestId("feel-today")).toContainText("Ondt i maven");

    // The other screen hears it through the feed: within the polling interval without a socket.
    await expect(other.getByTestId("feel-today")).toContainText("Ondt i maven kl.", {
      timeout: 45_000,
    });
    await expect(other.getByTestId("feel-today")).toContainText("Jonas");

    // The viewer-safe read: kinds, times and names, nothing from Reading.
    const from = new Date(Date.parse(saved.ts) - 60_000).toISOString();
    const to = new Date(Date.parse(saved.ts) + 60_000).toISOString();
    const listed = await page.request.get(
      `/api/spaces/${space.spaceId}/symptoms?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(listed.status()).toBe(200);
    const body = (await listed.json()) as { symptoms: { id: string }[] };
    expect(body.symptoms.map((s) => s.id)).toContain(saved.id);
    assertMealOnly(body);

    const deleting = page.waitForResponse(
      (r) => r.url().endsWith(`/symptoms/${saved.id}`) && r.request().method() === "DELETE",
    );
    await status.getByRole("button", { name: "Fortryd" }).click();
    expect((await deleting).status()).toBe(204);
    symptomId = null;
    await expect(status).toContainText("Fortrudt");
    await expect(page.getByTestId("feel-today")).toContainText("Intet logget i dag");
  } finally {
    if (symptomId) await prisma.symptom.deleteMany({ where: { id: symptomId } });
    await otherContext.close();
  }
});

test("Mere… logs a kind with severity, a note and a time through the sheet", async ({ page }) => {
  const space = await seededSpace();
  await registerFromInvite(page, await inviteLink("mette"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto("/da/feel");
  await expect(page.getByTestId("feel-grid")).toBeVisible();
  await page.getByRole("button", { name: "Mere…", exact: true }).click();
  const sheet = page.getByTestId("symptom-sheet");
  await sheet.getByRole("radio", { name: "Hovedpine", exact: true }).click();
  await sheet.getByRole("radio", { name: "En del", exact: true }).click();
  await sheet.getByLabel("Note").fill("Efter fodbold");
  await sheet.getByLabel("Hvornår?").fill("14:30");
  const saving = page.waitForResponse(
    (r) => r.url().endsWith("/symptoms") && r.request().method() === "POST",
  );
  await sheet.getByRole("button", { name: "Log det", exact: true }).click();
  const response = await saving;
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  try {
    expect(response.request().postDataJSON()).toMatchObject({
      kind: "headache",
      severity: "medium",
      note: "Efter fodbold",
    });
    await expect(page.getByTestId("feel-status")).toContainText("Hovedpine er logget");
    await expect(page.getByTestId("feel-today")).toContainText("Hovedpine kl. 14:30 · Mette");
  } finally {
    expect((await page.request.delete(`/api/spaces/${space.spaceId}/symptoms/${id}`)).ok()).toBe(
      true,
    );
  }
});

test("Alma's simpleMode picker is tiles only, and her tap sends the kind alone", async ({
  page,
}) => {
  await registerFromInvite(page, await inviteLink("alma"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto("/da/feel");
  const picker = page.getByTestId("feel");
  await expect(picker).toHaveAttribute("data-simple", "true");
  await expect(page.getByTestId("feel-grid").getByRole("button")).toHaveCount(KINDS.length);
  await expect(page.getByRole("button", { name: "Mere…" })).toHaveCount(0);
  const saving = page.waitForResponse(
    (r) => r.url().endsWith("/symptoms") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Træt", exact: true }).click();
  const response = await saving;
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  try {
    expect(response.request().postDataJSON()).toEqual({ kind: "tired" });
    await expect(page.getByTestId("feel-status")).toContainText("Træt er logget");
    await expect(page.getByTestId("symptom-sheet")).toHaveCount(0);
    const events = await prisma.event.findMany({ where: { type: "symptom.created" } });
    expect(
      events.filter((e) => (JSON.parse(e.payload) as { symptomId: string }).symptomId === id),
    ).toHaveLength(1);
  } finally {
    // Alma may not delete afterwards (simpleMode); the test tidies up directly.
    await prisma.symptom.deleteMany({ where: { id } });
  }
});
