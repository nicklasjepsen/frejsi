// Issue 214: on the phone every page sits 20 px under the space name, and the gap is the shell's
// alone (its `main`, under the header), so no screen draws its own or forgets it. Measured, not
// snapshotted: a runner's font rasteriser differs from a workstation's by a few pixels, which is no
// finding. From 1280 px the phone header is hidden and the desktop main column keeps its own 28 px.
import { prisma } from "@frejsi/shared";
import type { Locator, Page } from "@playwright/test";

import { inviteLink, registerFromInvite, seededSpace } from "./support";
import { expect, test } from "./test";

test.use({ serviceWorkers: "block" });

const GAP = 20;
const DESKTOP_MAIN_TOP = "28px";

interface Measure {
  /** The bottom of the phone header (the space-name row), or null where none is drawn. */
  headerBottom: number | null;
  /** The top of the first thing the page draws: the lowest top of any visible box in `main`. */
  contentTop: number;
  /** The top padding of the shell's column (header and `main`), of `main`, and of the page root. */
  columnPadding: string;
  mainPadding: string;
  rootPadding: string;
}

/** Opens a screen and waits until it has drawn: its visible `h1`, or `ready` where it has none. */
async function open(
  page: Page,
  path: string,
  url: RegExp,
  ready: (page: Page) => Locator = (p) => p.locator("main h1").filter({ visible: true }).first(),
): Promise<void> {
  await page.goto(path);
  await page.waitForURL(url);
  await expect(ready(page)).toBeVisible();
}

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    window.scrollTo(0, 0);
    const shell = document.querySelector('[data-testid="app-shell"]');
    const main = shell?.querySelector("main");
    const root = main?.firstElementChild;
    if (!main || !root || !main.parentElement) throw new Error("no page in shell");
    const header = shell?.querySelector('[data-testid="phone-header"]');
    const headerRect = header?.getBoundingClientRect();
    let contentTop = Number.POSITIVE_INFINITY;
    for (const el of main.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.position === "fixed") continue;
      const rect = el.getBoundingClientRect();
      // A screen-reader-only box is 1 px and clipped; it is not something the page draws.
      if (rect.width > 1 && rect.height > 1) contentTop = Math.min(contentTop, rect.top);
    }
    return {
      headerBottom: headerRect && headerRect.height > 0 ? headerRect.bottom : null,
      contentTop,
      columnPadding: getComputedStyle(main.parentElement).paddingTop,
      mainPadding: getComputedStyle(main).paddingTop,
      rootPadding: getComputedStyle(root).paddingTop,
    };
  });
}

async function expectGap(page: Page, name: string): Promise<void> {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const m = await measure(page);
    const label = `${name} ${colorScheme}`;
    expect(m.rootPadding, `${label}: the page draws no top padding of its own`).toBe("0px");
    if (desktop) {
      expect(m.headerBottom, label).toBeNull();
      expect(m.columnPadding, `${label}: the desktop column keeps its own`).toBe(DESKTOP_MAIN_TOP);
      expect(m.mainPadding, label).toBe("0px");
      continue;
    }
    expect(m.headerBottom, `${label}: the space-name row`).not.toBeNull();
    expect(m.columnPadding, label).toBe("0px");
    expect(m.mainPadding, label).toBe(`${String(GAP)}px`);
    expect(m.contentTop - (m.headerBottom ?? 0), `${label}: under the space name`).toBeCloseTo(
      GAP,
      0,
    );
  }
}

/** /eat and /feel draw no phone header; the page stays 20 px from the top, as before. */
async function expectChromeless(page: Page, name: string): Promise<void> {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1280;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const m = await measure(page);
    const label = `${name} ${colorScheme}`;
    expect(m.headerBottom, `${label}: no space-name row`).toBeNull();
    expect(m.rootPadding, label).toBe("0px");
    if (desktop) {
      expect(m.columnPadding, label).toBe(DESKTOP_MAIN_TOP);
      expect(m.mainPadding, label).toBe("0px");
      continue;
    }
    expect(m.mainPadding, label).toBe(`${String(GAP)}px`);
    expect(m.contentTop, `${label}: from the top of the screen`).toBeCloseTo(GAP, 0);
  }
}

test("Jonas's screens sit 20 px under the space name, and /eat and /feel stay put", async ({
  page,
}) => {
  const space = await seededSpace();
  const food = await prisma.food.findFirstOrThrow({
    where: { spaceId: space.spaceId, name: "Rugbrød" },
  });
  await registerFromInvite(page, await inviteLink("jonas"));
  await page.waitForURL(/\/da\/now$/);

  const screens: [string, string, RegExp][] = [
    ["recipe", "/da/recipe/new", /\/da\/recipe\/new$/],
    ["edit food", `/da/library/${food.id}`, new RegExp(`/da/library/${food.id}$`)],
    ["log", "/da/log", /\/da\/log$/],
    ["library", "/da/library", /\/da\/library$/],
    ["colour", "/da/settings/colour", /\/da\/settings\/colour$/],
    ["source", "/da/settings/source", /\/da\/settings\/source$/],
    ["connect", "/da/settings/source/connect?type=nightscout", /\/connect\?type=nightscout$/],
    ["import", "/da/settings/import", /\/da\/settings\/import$/],
    ["history day", "/da/history", /\/da\/history$/],
    ["history week", "/da/history/week", /\/da\/history\/week$/],
    ["people", "/da/people", /\/da\/people$/],
  ];
  for (const [name, path, url] of screens) {
    await open(page, path, url);
    await expectGap(page, name);
  }

  // Nu and Spørg drew their own 28 and 20 px before the owner chose one gap everywhere (#218).
  await open(page, "/da/now", /\/da\/now$/, (p) => p.getByTestId("now"));
  await expectGap(page, "now");
  await open(page, "/da/ask", /\/da\/ask$/, (p) =>
    p.getByRole("button", { name: "Tag et billede", exact: true }),
  );
  await expectGap(page, "ask");

  await open(page, "/da/eat", /\/da\/eat$/);
  await expectChromeless(page, "eat");
  await open(page, "/da/feel", /\/da\/feel$/);
  await expectChromeless(page, "feel");
});

test("the viewer's today and earlier days sit 20 px under the space name", async ({ page }) => {
  await registerFromInvite(page, await inviteLink("laerke"));
  await page.waitForURL(/\/da\/today$/);
  // I dag drew its own 28 px before (#218).
  await expect(page.getByTestId("today").locator("h1")).toBeVisible();
  await expectGap(page, "today");
  await open(page, "/da/history", /\/da\/history$/);
  await expect(page.getByTestId("viewer-days")).toBeVisible();
  await expectGap(page, "viewer days");
});

// Nu-Simpel drew its own 36 px and Spørg its own 20 before the owner chose one gap (#218).
test("simpleMode's Nu and Spørg sit 20 px under the space name", async ({ page }) => {
  await registerFromInvite(page, await inviteLink("alma"));
  await page.waitForURL(/\/da\/now$/);
  await expect(page.getByTestId("now-simple")).toBeVisible();
  await expectGap(page, "now simple");
  await open(page, "/da/ask", /\/da\/ask$/, (p) =>
    p.getByRole("button", { name: "Tag et billede", exact: true }),
  );
  await expectGap(page, "ask simple");
});
