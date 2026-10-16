// What the flows share: the seeded space as the database has it, a fresh add-a-device link for
// a seeded person (made through `web/src/lib/auth/`, as People makes one), and passkey
// registration through Chrome's virtual authenticator, so no test-only sign-in exists (decision 24).
import { prisma } from "@frejsi/shared";
import { expect, type Page } from "@playwright/test";

import {
  SEED_ARNES_ROOM,
  SEED_PEOPLE,
  SEED_SPACE,
  deviceInvite,
  type SeedPersonKey,
  type SeededSpace,
} from "../scripts/seed";

/** The space the global setup seeded, read back from the database. */
export async function seededSpace(): Promise<SeededSpace> {
  const space = await prisma.space.findFirstOrThrow({
    where: { name: SEED_SPACE.name },
    include: { memberships: { include: { user: true } } },
  });
  const people = {} as SeededSpace["people"];
  for (const key of Object.keys(SEED_PEOPLE) as SeedPersonKey[]) {
    const person = SEED_PEOPLE[key];
    const member = space.memberships.find((m) => m.user.name === person.name);
    if (!member) throw new Error(`seeded person ${key} is missing`);
    people[key] = { ...person, userId: member.userId };
  }
  const readings = await prisma.reading.count({ where: { spaceId: space.id } });
  return { spaceId: space.id, people, ownerInviteUrl: "", readings };
}

/** "Arnes rum" (the manual-source space), read back from the database. */
export async function seededArnesRoom(): Promise<{ spaceId: string }> {
  const space = await prisma.space.findFirstOrThrow({ where: { name: SEED_ARNES_ROOM.name } });
  return { spaceId: space.id };
}

/** A single-use link for this test only; links are spent by registering. */
export async function inviteLink(key: SeedPersonKey): Promise<string> {
  return (await deviceInvite(await seededSpace(), key)).url;
}

/**
 * Opens the invitation with a virtual platform authenticator (user verification on, presence
 * simulated) attached to the page, and presses the one visible "Opret adgang" button.
 */
export async function registerFromInvite(page: Page, url: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(url);
  const button = page.getByRole("button", { name: /^Opret adgang med denne/ }).filter({
    visible: true,
  });
  await expect(button).toHaveCount(1);
  await button.click();
}

/** The navigation the shell shows at this width: bottom tabs under 1280 px, the sidebar from it. */
export async function navLabels(page: Page): Promise<string[]> {
  const width = page.viewportSize()?.width ?? 0;
  const labels =
    width < 1280
      ? page.getByTestId("phone-tabs").getByRole("link")
      : page.getByTestId("sidebar").getByTestId("label");
  await expect(labels.first()).toBeVisible();
  return (await labels.allInnerTexts()).map((text) => text.trim());
}

/**
 * Keys that carry glucose (v0.3.0 §9, spec §2). A viewer's session must never receive one in any
 * JSON from `/api/spaces/`; the walk is over every key at every depth.
 */
export const VIEWER_FORBIDDEN_KEYS = new Set([
  "mmol",
  "mgdl",
  "trend",
  "reading",
  "readings",
  "glucose",
  "peak",
  "inRange",
  "inRangePercent",
  "stats",
  "curve",
  "bolusTs",
  "bolusLead",
  "bolusLeadMinutes",
  "summary",
  "questions",
  "questionsEdited",
  "statsHash",
]);

export function assertMealOnly(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertMealOnly(item);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      expect(VIEWER_FORBIDDEN_KEYS.has(key), key).toBe(false);
      assertMealOnly(item);
    }
  }
}

/** Opens the space switcher this width shows and picks a space by name. */
export async function switchToSpace(page: Page, name: string): Promise<void> {
  const switcher = page.locator("details").filter({ has: page.getByLabel(/^Du er i /) });
  const summary = switcher.locator("summary").filter({ visible: true });
  await summary.click();
  await switcher
    .getByRole("button", { name: new RegExp(name) })
    .filter({ visible: true })
    .click();
}
