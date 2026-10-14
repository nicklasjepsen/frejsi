import { createLogger, type PollCycleDeps, type SpaceOutcome } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { createPollHandler, JITTER_MAX_MS, jitterMs, SCHEDULE } from "./poll-handler";

describe("the poll timer", () => {
  it("runs at second 0 of every fifth minute", () => {
    expect(SCHEDULE).toBe("0 */5 * * * *");
  });

  it("jitters between 0 and 20 seconds", () => {
    expect(JITTER_MAX_MS).toBe(20_000);
    expect(jitterMs(() => 0)).toBe(0);
    expect(jitterMs(() => 0.5)).toBe(10_000);
    expect(jitterMs(() => 0.999999)).toBeLessThan(20_000);
    for (let i = 0; i < 50; i += 1) {
      const ms = jitterMs();
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(JITTER_MAX_MS);
    }
  });
});

function harness(outcomes: SpaceOutcome[], storedPerSpace: Record<string, number> = {}) {
  const lines: string[] = [];
  const events: { name: string; properties: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  let cycleDeps: PollCycleDeps | undefined;
  const handler = createPollHandler({
    runCycle: (deps) => {
      cycleDeps = deps;
      for (const [spaceId, n] of Object.entries(storedPerSpace)) {
        for (let i = 0; i < n; i += 1) deps.onReadingStored?.(spaceId);
      }
      return Promise.resolve(outcomes);
    },
    cycleDeps: {
      db: {} as PollCycleDeps["db"],
      sources: () => Promise.reject(new Error("unused")),
    },
    track: (name, properties) => events.push({ name, properties: properties ?? {} }),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.25,
    log: createLogger((line) => lines.push(line)),
  });
  return { handler, lines, events, sleeps, cycleDeps: () => cycleDeps };
}

const timer = {
  isPastDue: false,
  schedule: { adjustForDST: true },
  scheduleStatus: { last: "", next: "", lastUpdated: "" },
};

describe("createPollHandler", () => {
  it("waits the jitter, runs the cycle and tracks reading.stored per new reading with the spaceId only", async () => {
    const h = harness(
      [
        { spaceId: "s1", outcome: "ok", code: "ok", stored: 2, status: "connected" },
        {
          spaceId: "s2",
          outcome: "failed",
          code: "fetch-failed",
          stored: 0,
          status: "disconnected",
        },
      ],
      { s1: 2 },
    );
    await h.handler(timer, {} as never);
    expect(h.sleeps).toEqual([5_000]);
    expect(h.events).toEqual([
      { name: "reading.stored", properties: { spaceId: "s1" } },
      { name: "reading.stored", properties: { spaceId: "s1" } },
    ]);
  });

  it("logs the cycle summary with counts and codes only", async () => {
    const h = harness([
      { spaceId: "s1", outcome: "ok", code: "ok", stored: 6, status: "connected" },
      {
        spaceId: "s2",
        outcome: "failed",
        code: "source-unavailable",
        stored: 0,
        status: "connected",
      },
    ]);
    await h.handler(timer, {} as never);
    const summary = h.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === "poll.cycle");
    expect(summary).toMatchObject({ level: "warn", count: 6, code: "1-failed" });
    for (const line of h.lines) {
      const keys = Object.keys(JSON.parse(line) as object);
      expect(
        keys.every((k) => ["ts", "level", "msg", "spaceId", "count", "code", "ms"].includes(k)),
      ).toBe(true);
    }
  });

  it("is quiet at info level when every space succeeded", async () => {
    const h = harness([
      { spaceId: "s1", outcome: "ok", code: "ok", stored: 0, status: "connected" },
    ]);
    await h.handler(timer, {} as never);
    const summary = h.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === "poll.cycle");
    expect(summary).toMatchObject({ level: "info", count: 0, code: "ok" });
  });
});
