import path from "node:path";
import { prisma, createEmit, weekRange } from "@frejsi/shared";
import { createInsight, PrismaInsightRepository } from "@frejsi/shared/insights/store";
import { SEED_TRANSCRIPT } from "../scripts/seed";
import { inviteLink, registerFromInvite, seededSpace } from "./support";
import { expect, test } from "./test";

test.use({ serviceWorkers: "block" });
test("Alma asks about a plate and Jonas verifies it before it enters Min mad", async ({
  page,
  browser,
}) => {
  const space = await seededSpace();
  await registerFromInvite(page, await inviteLink("alma"));
  await page.waitForURL(/\/da\/now$/);
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  await page
    .getByTestId(desktop ? "sidebar" : "phone-tabs")
    .getByRole("link", { name: desktop ? "Spørg en voksen" : "Spørg", exact: true })
    .click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Tag et billede", exact: true }).click();
  await (await chooser).setFiles(path.join(__dirname, "fixtures/plate.jpg"));
  await expect(page.getByRole("heading", { name: "Det ligner" })).toBeVisible();
  await expect(page.getByText("Et gæt · ikke tjekket", { exact: true })).toBeVisible();
  const asking = page.waitForResponse(
    (r) => r.url().endsWith("/estimates/ask") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Spørg en voksen", exact: true }).click();
  const response = await asking;
  expect(response.status()).toBe(201);
  const { foodId } = (await response.json()) as { foodId: string };
  await expect(page.getByRole("status")).toContainText(/Sendt til/);
  for (const name of ["Jonas", "Mette", "Birthe"])
    await expect(page.getByRole("status")).toContainText(name);
  await page.waitForURL(/\/da\/now$/);
  const events = await prisma.event.findMany({
    where: { spaceId: space.spaceId, type: "estimate.asked" },
  });
  expect(
    events.filter((e) => (JSON.parse(e.payload) as { foodId: string }).foodId === foodId),
  ).toHaveLength(1);
  const before = await page.request.get(`/api/spaces/${space.spaceId}/foods?filter=all`);
  expect(
    ((await before.json()) as { foods: { id: string }[] }).foods.some((f) => f.id === foodId),
  ).toBe(false);
  await page.goto("/da/eat");
  await expect(page.getByRole("button", { name: "Example dish", exact: true })).toHaveCount(0);

  const adultContext = await browser.newContext({
    viewport: page.viewportSize(),
    locale: "da-DK",
    timezoneId: "Europe/Copenhagen",
  });
  const adult = await adultContext.newPage();
  await adult.clock.setFixedTime(new Date(process.env.E2E_NOW ?? ""));
  try {
    await registerFromInvite(adult, await inviteLink("jonas"));
    await adult.waitForURL(/\/da\/now$/);
    await expect(
      adult.getByText("Alma spurgte om et billede · Gennemgå og godkend").filter({ visible: true }),
    ).toBeVisible();
    await adult
      .getByRole("link", { name: /Fødevarer der ikke er tjekket/ })
      .filter({ visible: true })
      .click();
    const region = adult.getByTestId(desktop ? "library-desktop" : "library-phone");
    const row = region.getByRole(desktop ? "row" : "listitem").filter({ hasText: "Example dish" });
    await expect(row).toContainText(desktop ? "AI fra billede" : "Et gæt");
    await expect(row).toContainText("Et gæt");
    if (desktop) await row.getByRole("button", { name: /^Ret Example dish/ }).click();
    else await row.getByRole("link").click();
    await adult
      .getByRole("button", { name: "Gem og godkend", exact: true })
      .filter({ visible: true })
      .click();
    await expect
      .poll(async () => (await prisma.food.findUniqueOrThrow({ where: { id: foodId } })).verified)
      .toBe(true);
    await adult.goto("/da/library");
    const checked = adult
      .getByTestId(desktop ? "library-desktop" : "library-phone")
      .getByRole(desktop ? "row" : "listitem")
      .filter({ hasText: "Example dish" });
    if (desktop) await expect(checked).toContainText("Tjekket");
    else await expect(checked.getByRole("img", { name: "Tjekket", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Example dish", exact: true })).toBeVisible();
    const after = await page.request.get(`/api/spaces/${space.spaceId}/foods?filter=all`);
    expect(
      ((await after.json()) as { foods: { id: string; verified: boolean }[] }).foods.find(
        (f) => f.id === foodId,
      )?.verified,
    ).toBe(true);
  } finally {
    expect((await adult.request.delete(`/api/spaces/${space.spaceId}/foods/${foodId}`)).ok()).toBe(
      true,
    );
    await adultContext.close();
  }
});

test("Sig det saves a meal, lunch shows its stored Observation and week questions survive reload", async ({
  page,
}) => {
  const space = await seededSpace();
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);
  await page.goto("/da/log");
  await page
    .getByRole("button", { name: /^Sig det/ })
    .filter({ visible: true })
    .click();
  await page.getByRole("textbox", { name: "Skriv hvad der spises" }).fill(SEED_TRANSCRIPT);
  await page.getByRole("button", { name: "Find maden", exact: true }).click();
  await expect(
    page
      .getByRole("heading", { name: "Example pasta · ca. 30 g", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tilføj til måltidet", exact: true }).click();
  const saving = page.waitForResponse(
    (r) => r.url().endsWith("/meals") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: /^Gem måltid/ })
    .filter({ visible: true })
    .click();
  const saved = await saving;
  expect(saved.status()).toBe(201);
  const { id } = (await saved.json()) as { id: string };
  try {
    await page.waitForURL(/\/da\/now$/);
    await expect(
      page
        .getByTestId("meals-table")
        .getByText("Example pasta", { exact: true })
        .or(page.getByTestId("last-meal").getByText("Example pasta", { exact: true }))
        .filter({ visible: true }),
    ).toBeVisible();
  } finally {
    expect((await page.request.delete(`/api/spaces/${space.spaceId}/meals/${id}`)).ok()).toBe(true);
  }
  const lunch = await prisma.meal.findFirstOrThrow({
    where: { spaceId: space.spaceId, note: "Rugbrød med ost og et æble" },
    orderBy: { ts: "desc" },
  });
  await page.goto(`/da/meal/${lunch.id}`);
  await expect(
    page.getByText("Observation · AI", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  const stored = await prisma.insight.findUniqueOrThrow({
    where: {
      spaceId_kind_subjectKey: {
        spaceId: space.spaceId,
        kind: "meal",
        subjectKey: `${lunch.id}:da`,
      },
    },
  });
  await expect(
    page.getByText(stored.text, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(
    new Date(process.env.E2E_NOW ?? ""),
  );
  const current = weekRange(today, "Europe/Copenhagen").weekStart;
  const previous = new Date(`${current}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 7);
  const start = previous.toISOString().slice(0, 10);
  await createInsight(
    new PrismaInsightRepository(prisma),
    createEmit({ db: prisma, sink: { publish: () => Promise.resolve() } }),
    {
      spaceId: space.spaceId,
      kind: "week",
      subjectKey: start,
      statsHash: "fixture-week",
      text: "Ugen indeholder flere måltider omkring frokost.",
      questions: ["Hvilke mønstre ses efter frokost i denne uge?"],
      rejectedCount: 0,
      provider: "fake",
      model: "fixture",
    },
  );
  await page.goto(`/da/history/week?start=${start}#opsummering`);
  await expect(page.getByRole("heading", { name: "Spørgsmål til klinikken" })).toBeVisible();
  await page.getByRole("button", { name: "Ret spørgsmålene" }).click();
  const question = "Hvordan fordeler ugens måltider sig over dagen?";
  await page.locator("#opsummering textarea").fill(question);
  await page.locator("#opsummering").getByRole("button", { name: "Gem", exact: true }).click();
  await expect(page.locator("#opsummering").getByRole("status")).toHaveText("Gemt");
  await page.reload();
  await expect(page.locator("#opsummering li")).toHaveText(question);
});
