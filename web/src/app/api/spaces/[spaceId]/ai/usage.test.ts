// @vitest-environment node
import { expect, it } from "vitest";
import type { PrismaClient } from "@frejsi/shared";
import type { AiCallWindow } from "@frejsi/shared/ai";
import { loadAiUsage } from "./usage";
it("counts attempts in the space's local day across a DST change, with independent caps", async () => {
  const windows: AiCallWindow[] = [];
  const db = {
    space: {
      findUnique: () =>
        Promise.resolve({ aiEnabled: false, aiProvider: null, timezone: "Europe/Copenhagen" }),
    },
  } as unknown as Pick<PrismaClient, "space">;
  const usage = await loadAiUsage("s1", {
    db,
    env: { AI_DAILY_CAP: "12", AI_EMBED_DAILY_CAP: "34" },
    now: new Date("2026-10-25T22:30:00Z"),
    calls: {
      count: (window) => {
        windows.push(window);
        return Promise.resolve(window.kinds.includes("embed") ? 4 : 3);
      },
    },
  });
  expect(windows).toEqual([
    {
      spaceId: "s1",
      from: new Date("2026-10-24T22:00:00Z"),
      to: new Date("2026-10-25T23:00:00Z"),
      kinds: ["complete", "vision"],
    },
    {
      spaceId: "s1",
      from: new Date("2026-10-24T22:00:00Z"),
      to: new Date("2026-10-25T23:00:00Z"),
      kinds: ["embed"],
    },
  ]);
  expect(usage).toMatchObject({
    callsToday: 3,
    embedCallsToday: 4,
    dailyCap: 12,
    embedDailyCap: 34,
  });
  expect(usage.providers.every((p) => !p.configured)).toBe(true);
});
