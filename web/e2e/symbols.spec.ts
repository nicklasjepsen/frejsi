// Symbols and symptoms on the curve (v0.6.0 plan §5 and §7, task 5): two taps from the phone's Nu
// to a logged symptom and its diamond on the day curve; the viewer sees the marker and the detail
// without any reading; a meal of rugbrød carries the bread symbol on history day and desktop Nu,
// and a later change of the food's category leaves the past meal's symbol as it was. Runs at
// 360 px (phone) and 1280 px (desktop).
import { prisma } from "@frejsi/shared";

import { assertMealOnly, inviteLink, registerFromInvite, seededSpace } from "./support";
import { expect, test } from "./test";

test.use({ serviceWorkers: "block" });

/** The seed's fixed afternoon, as the chart names it. */
const NOW_CLOCK = "15:13";

/** A reading's value in a JSON body, plain or escaped inside an RSC payload. */
const READING_KEY = /mmol\\?"\s*:\s*(\\?")?\d/;

test("two taps from Nu log a symptom, and the day curve shows its diamond with the detail", async ({
  page,
}) => {
  const { spaceId } = await seededSpace();
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  const saving = page.waitForResponse(
    (r) => r.url().endsWith("/symptoms") && r.request().method() === "POST",
  );
  if (desktop) {
    // The phone's button is hidden at this width; the sidebar's entry is the same picker.
    await page.getByTestId("sidebar").getByRole("link", { name: "Jeg har det…" }).click();
  } else {
    await page.getByRole("link", { name: "Jeg har det…" }).click();
  }
  await page.waitForURL(/\/da\/feel$/);
  await page
    .getByTestId("feel-grid")
    .getByRole("button", { name: "Hovedpine", exact: true })
    .click();
  const response = await saving;
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  try {
    await expect(page.getByTestId("feel-status")).toContainText("Hovedpine er logget");
    if (desktop) {
      await page.goto("/da/now");
      const card = page.getByTestId("now-desktop");
      await expect(card.getByTestId("symptom-marker")).toHaveCount(1);
      await card.getByRole("button", { name: `Hovedpine kl. ${NOW_CLOCK}` }).click();
    } else {
      await page.goto("/da/history");
      const today = page.getByTestId("history-day").first();
      await expect(today.getByTestId("symptom-marker")).toHaveCount(2); // the curve and the row
      await expect(
        today.getByRole("button", { name: `Hovedpine kl. ${NOW_CLOCK} · Jonas` }),
      ).toBeVisible();
      await today.getByRole("button", { name: `Hovedpine kl. ${NOW_CLOCK}`, exact: true }).click();
    }
    const detail = page.getByRole("dialog", { name: `Hovedpine kl. ${NOW_CLOCK}` });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Logget af Jonas");
    // The readings around it carry their times (the seed has readings up to now).
    const readings = detail.getByRole("list", { name: "Tal omkring" });
    await expect(readings.getByRole("listitem").first()).toContainText(
      /^\d\d:\d\d · \d+,\d mmol\/L · (lige nu|for .+ siden)$/,
    );
    await detail.getByRole("button", { name: "Luk" }).click();
    await expect(detail).toHaveCount(0);
    if (!desktop) {
      // "Symptomer" keeps the symptom rows and hides the meals.
      await page.getByRole("button", { name: "Symptomer" }).first().click();
      const today = page.getByTestId("history-day").first();
      await expect(today.getByTestId("meal-card")).toHaveCount(0);
      await expect(today.getByTestId("symptom-row")).toHaveCount(1);
    }
  } finally {
    expect((await page.request.delete(`/api/spaces/${spaceId}/symptoms/${id}`)).ok()).toBe(true);
  }
});

test("a viewer sees the symptom's marker and detail, and no reading reaches her", async ({
  page,
  browser,
}) => {
  const { spaceId } = await seededSpace();
  // Jonas logs; Lærke watches.
  const ownerContext = await browser.newContext({
    viewport: page.viewportSize(),
    locale: "da-DK",
    timezoneId: "Europe/Copenhagen",
  });
  const owner = await ownerContext.newPage();
  await owner.clock.setFixedTime(new Date(process.env.E2E_NOW ?? ""));
  let symptomId: string | null = null;
  try {
    await registerFromInvite(owner, await inviteLink("jonas"));
    await owner.waitForURL(/\/da\/now$/);
    const created = await owner.request.post(`/api/spaces/${spaceId}/symptoms`, {
      data: { kind: "dizzy", severity: "light", note: "Efter løb" },
    });
    expect(created.status()).toBe(201);
    symptomId = ((await created.json()) as { id: string }).id;

    let checked = 0;
    await page.route("**/*", async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const type = response.headers()["content-type"] ?? "";
      if (/json|html|text\/x-component/.test(type)) {
        const text = await response.text();
        if (type.includes("json") && new URL(response.url()).pathname.startsWith("/api/spaces/")) {
          assertMealOnly(JSON.parse(text) as unknown);
          checked++;
        }
        expect(text, response.url()).not.toMatch(READING_KEY);
      }
      await route.fulfill({ response });
    });
    await registerFromInvite(page, await inviteLink("laerke"));
    await page.waitForURL(/\/da\/today$/);
    await page.goto("/da/history");
    const rows = page.getByTestId("viewer-symptoms").first();
    await expect(rows.getByTestId("symptom-marker")).toHaveCount(1);
    await rows.getByRole("button", { name: `Svimmel kl. ${NOW_CLOCK} · Jonas` }).click();
    const detail = page.getByRole("dialog", { name: `Svimmel kl. ${NOW_CLOCK}` });
    await expect(detail).toContainText("Lidt");
    await expect(detail).toContainText("Efter løb");
    await expect(detail).toContainText("Logget af Jonas");
    await expect(detail.getByRole("list")).toHaveCount(0);
    await expect(detail).not.toContainText(/mmol|mg\/dL/);
    expect(checked).toBeGreaterThan(0);
    await page.unroute("**/*");
  } finally {
    if (symptomId) await prisma.symptom.deleteMany({ where: { id: symptomId } });
    await ownerContext.close();
  }
});

test("a meal of rugbrød carries the bread symbol, and a later category change leaves it", async ({
  page,
}) => {
  const { spaceId } = await seededSpace();
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  const foods = (await (
    await page.request.get(`/api/spaces/${spaceId}/foods?filter=all`)
  ).json()) as { foods: { id: string; name: string; category?: string | null }[] };
  const rye = foods.foods.find((food) => food.name === "Rugbrød");
  if (!rye) throw new Error("the seed's Rugbrød is missing");
  const setCategory = async (category: string | null) => {
    const response = await page.request.patch(`/api/spaces/${spaceId}/foods/${rye.id}`, {
      data: { category },
    });
    expect(response.ok()).toBe(true);
  };
  await setCategory("bread");
  // The seed already stores a bread symbol on one of today's meals (its lunch); the test's meal
  // adds one marker to whatever the day has, so the count is taken before it is logged.
  const scope = () =>
    desktop ? page.getByTestId("now-desktop") : page.getByTestId("history-day").first();
  const breadMarkers = () =>
    desktop
      ? scope()
          .getByRole("img", { name: /^Glukose i dag/ })
          .locator("[data-symbol=bread]")
      : scope().locator("svg [data-symbol=bread]");
  const markerPage = desktop ? "/da/now" : "/da/history";
  await page.goto(markerPage);
  await expect(
    scope()
      .getByRole("button", { name: /^Måltid, / })
      .first(),
  ).toBeVisible();
  const before = await breadMarkers().count();
  const logged = await page.request.post(`/api/spaces/${spaceId}/meals`, {
    data: { items: [{ foodId: rye.id, name: "Rugbrød", portionLabel: "1 skive" }] },
  });
  expect(logged.status()).toBe(201);
  const meal = (await logged.json()) as { id: string; symbol?: string };
  try {
    expect(meal.symbol).toBe("bread");
    const breadMarker = async () => {
      await page.goto(markerPage);
      await expect(breadMarkers()).toHaveCount(before + 1);
      await expect(
        scope().getByRole("button", { name: `Måltid, Brød, kl. ${NOW_CLOCK}` }),
      ).toBeVisible();
    };
    await breadMarker();
    // The library changes; the past meal does not (decision 2).
    await setCategory("fruit");
    await breadMarker();
    const stored = (await (
      await page.request.get(`/api/spaces/${spaceId}/meals/${meal.id}`)
    ).json()) as { symbol?: string };
    expect(stored.symbol).toBe("bread");
  } finally {
    expect((await page.request.delete(`/api/spaces/${spaceId}/meals/${meal.id}`)).ok()).toBe(true);
    await setCategory(rye.category ?? null);
  }
});
