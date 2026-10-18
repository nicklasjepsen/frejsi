// The pump record (v0.7.0 plan task 6): what the pump delivered, shown as history to owners and
// carers outside simpleMode, never to a viewer or a simpleMode session. The seed connected the
// pump record of Almas rum and ran one pump cycle over a fictional day of boluses (scripts/seed.ts,
// SEED_PUMP_BOLUSES): three standard boluses on seeded meals, an extended one that became the
// untouched pump meal, and three automatic ones. Nothing here talks to a Nightscout site.
import {
  PUMP_MEAL_SOURCE,
  prisma,
  runPumpCycle,
  type EventSink,
  type PumpSource,
} from "@frejsi/shared";
import type { Page } from "@playwright/test";

import { seedTime } from "../scripts/seed";
import { inviteLink, registerFromInvite, seededSpace } from "./support";
import { expect, test } from "./test";

const clock = () => new Date(process.env.E2E_NOW ?? "");
const DAY = 24 * 60 * 60_000;
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280;
/** The e2e has no Web PubSub (the app polls); the events still go to their table. */
const noLiveSink: EventSink = { publish: () => Promise.resolve() };

/** The day's boluses as the owner's curves name them: time and units, the automatic ones apart. */
const TODAY = [
  "Automatisk bolus 03:10 · 0,6 E",
  "Automatisk bolus 05:40 · 0,3 E",
  "Bolus 07:05 · 1,8 E",
  "Bolus 09:45 · 0,7 E",
  "Automatisk bolus 13:45 · 0,4 E",
];

/** A window for `/pump` that holds the whole seeded record. */
function pumpQuery(): string {
  const now = clock();
  return new URLSearchParams({
    from: new Date(now.getTime() - 2 * DAY).toISOString(),
    to: now.toISOString(),
  }).toString();
}

/**
 * An untouched pump meal for this width's run. The phone run ticks the seeded one, so the desktop
 * run gets its own the way the poller makes one: a pump cycle over a fictional extended bolus with
 * carbs that nobody logged, read through the same store, with its `pump.imported` and `pump.meals`.
 */
async function untouchedPumpMeal(spaceId: string): Promise<{ id: string }> {
  const existing = await prisma.meal.findFirst({
    where: { spaceId, source: PUMP_MEAL_SOURCE },
    select: { id: true },
  });
  if (existing) return existing;
  const bolus = {
    sourceId: "e2e-desktop-extended",
    ts: seedTime(new Date(clock().getTime() - DAY), 20, 0),
    units: 1.5,
    kind: "extended" as const,
    carbs: 30,
  };
  const source: PumpSource = {
    fetchBolusesSince: (since) =>
      Promise.resolve(Date.parse(bolus.ts) >= since.getTime() ? [bolus] : []),
    probe: () => Promise.resolve("ok"),
  };
  const [outcome] = await runPumpCycle(
    { db: prisma, sources: () => source, sink: noLiveSink, now: clock },
    { spaceId },
  );
  expect(outcome).toMatchObject({ outcome: "ok", mealsCreated: 1 });
  return prisma.meal.findFirstOrThrow({
    where: { spaceId, source: PUMP_MEAL_SOURCE },
    select: { id: true },
  });
}

test("the owner sees the day's boluses with their units on Now and in the history day", async ({
  page,
}) => {
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = isDesktop(page);
  if (desktop) {
    // The day curve runs from 06:00: the morning's boluses and Control-IQ's 13:45 one, each named
    // with its time and units.
    for (const name of TODAY.slice(2)) {
      await expect(
        page.getByRole("button", { name, exact: true }).filter({ visible: true }),
      ).toBeVisible();
    }
    // The manual triangles carry their units on desktop; the automatic one is hollow.
    await expect(page.getByTestId("pump-label").filter({ visible: true })).toHaveText([
      "1,8 E",
      "0,7 E",
    ]);
    const shapes = await page
      .getByTestId("pump-bolus")
      .filter({ visible: true })
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-shape")));
    expect(shapes.filter((shape) => shape === "hollow")).toHaveLength(1);
    // Tandem's upload lags: the curve says how far the record reaches.
    await expect(page.getByTestId("pump-reach-caption").filter({ visible: true })).toHaveText(
      "Pumpe til 13:45",
    );
  } else {
    // The phone's sparkline holds the last three hours: Control-IQ's 13:45 bolus.
    const auto = page
      .getByRole("button", { name: "Automatisk bolus 13:45 · 0,4 E" })
      .filter({ visible: true });
    await expect(auto).toBeVisible();
    await auto.click();
    await expect(page.getByTestId("pump-popover").filter({ visible: true })).toHaveText(
      "Automatisk bolus 13:45 · 0,4 E",
    );
  }

  await page.goto("/da/history");
  const today = page.getByTestId("history-day").first();
  const dayTaps = today.getByTestId("pump-tap");
  await expect(dayTaps).toHaveCount(TODAY.length);
  expect(
    await dayTaps.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
  ).toEqual(TODAY);
  if (desktop) {
    await expect(today.getByTestId("pump-label")).toHaveText(["1,8 E", "0,7 E"]);
  } else {
    // No labels on the phone: a tap opens the popover with the time, the units and the kind.
    await expect(today.getByTestId("pump-label")).toHaveCount(0);
    await today.getByRole("button", { name: "Bolus 07:05 · 1,8 E" }).click();
    await expect(today.getByTestId("pump-popover")).toHaveText("Bolus 07:05 · 1,8 E");
  }
});

test("a meal shows the pump's bolus before it with the minutes and the units", async ({ page }) => {
  const { spaceId } = await seededSpace();
  const breakfast = await prisma.meal.findFirstOrThrow({
    where: { spaceId, items: { some: { name: "Havregrød med æble" } }, source: null },
    select: { id: true, pumpBolusId: true },
  });
  expect(breakfast.pumpBolusId).not.toBeNull();
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto(`/da/meal/${breakfast.id}`);
  await expect(page.getByTestId("meal-bolus").filter({ visible: true })).toHaveText(
    "Bolus 07:05 · 1,8 E",
  );
  const tiles = page.getByTestId("meal-tiles");
  await expect(tiles).toContainText("Bolus");
  await expect(tiles).toContainText("10 min");
  // "før måltidet" on the phone, "før" in the desktop tile.
  await expect(tiles).toContainText("før");
  // The carbs typed into the pump, next to what was logged.
  await expect(
    page
      .getByText(/Pumpen: 38 g/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  // The meal curve labels its own bolus with the units.
  await expect(page.getByTestId("curve-card").getByTestId("pump-label")).toHaveText(["1,8 E"]);
});

test("a viewer and a simpleMode member see nothing from the pump, and /pump is 403 for both", async ({
  browser,
}) => {
  const { spaceId } = await seededSpace();
  const pumpMeal = await untouchedPumpMeal(spaceId);
  const now = clock();
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(
    new Date(now.getTime() - DAY),
  );

  for (const who of ["laerke", "alma"] as const) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await page.clock.setFixedTime(now);
    try {
      await registerFromInvite(page, await inviteLink(who));
      await page.waitForURL(who === "laerke" ? /\/da\/today$/ : /\/da\/now$/);
      for (const path of who === "laerke" ? ["/da/today", "/da/history"] : ["/da/now"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expect(page.getByTestId("pump-tap"), path).toHaveCount(0);
        await expect(page.getByTestId("pump-bolus"), path).toHaveCount(0);
        await expect(page.getByTestId("pump-reach"), path).toHaveCount(0);
        // The untouched pump meal is nowhere in what the server sends for the page. (A pump meal
        // someone ticked is the household's meal, and a viewer sees it like any other.)
        expect(await (await page.request.get(path)).text(), path).not.toContain(pumpMeal.id);
      }
      // The API, not only the screens.
      for (const route of [`pump?${pumpQuery()}`, "pump-source"]) {
        const denied = await page.request.get(`/api/spaces/${spaceId}/${route}`);
        expect(denied.status(), `${who} ${route}`).toBe(403);
      }
      // Yesterday's day leaves the untouched pump meal out and carries no pump field.
      const day = await page.request.get(`/api/spaces/${spaceId}/day?date=${yesterday}`);
      expect(day.status()).toBe(200);
      const text = await day.text();
      expect(text).not.toContain(pumpMeal.id);
      expect(text).not.toMatch(/"(?:bolusUnits|pumpCarbs|pumpBolusId|fromPump|units)"\s*:/);
      if (who === "alma") {
        expect(
          (await page.request.get(`/api/spaces/${spaceId}/meals/${pumpMeal.id}`)).status(),
        ).toBe(404);
      }
    } finally {
      await context.close();
    }
  }
});

test("the owner ticks a pump meal, and it becomes an ordinary meal", async ({ page }) => {
  const { spaceId } = await seededSpace();
  const pumpMeal = await untouchedPumpMeal(spaceId);
  const { lastSeq: before } = await prisma.space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { lastSeq: true },
  });
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto(`/da/meal/${pumpMeal.id}`);
  const badge = page.getByText("Fra pumpen · ikke tjekket", { exact: true }).filter({
    visible: true,
  });
  await expect(badge).toBeVisible();
  await expect(
    page.getByText("Kulhydrater fra pumpen").filter({ visible: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Det passer", exact: true })
    .filter({ visible: true })
    .click();
  await expect(badge).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Det passer", exact: true })).toHaveCount(0);

  const row = await prisma.meal.findUniqueOrThrow({ where: { id: pumpMeal.id } });
  expect(row.source).toBeNull();
  expect(row.pumpBolusId).not.toBeNull();
  // The tick is a person's write: one meal.updated for this meal, through emit.
  const events = await prisma.event.findMany({
    where: { spaceId, type: "meal.updated", seq: { gt: before } },
  });
  expect(
    events.filter(
      (event) => (JSON.parse(event.payload) as { mealId: string }).mealId === pumpMeal.id,
    ),
  ).toHaveLength(1);
});
