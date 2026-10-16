import { Health, createLogger } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { FRESH_READING_MINUTES, computeHealth, type HealthDb } from "./health";

const NOW = new Date("2026-10-15T08:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

function fakeDb(opts: { fails?: boolean; latest?: Date | null }): HealthDb {
  return {
    $queryRaw: () =>
      opts.fails ? Promise.reject(new Error("no db")) : Promise.resolve([{ ok: 1 }]),
    reading: {
      findFirst: () =>
        Promise.resolve(
          opts.latest === undefined || opts.latest === null ? null : { ts: opts.latest },
        ),
    },
  } as unknown as HealthDb;
}

describe("computeHealth (plan decision 22)", () => {
  it("reports version from NEXT_PUBLIC_APP_VERSION, db ok and ok true when the database answers", async () => {
    const health = await computeHealth({
      db: fakeDb({ latest: null }),
      now: () => NOW,
      env: { NEXT_PUBLIC_APP_VERSION: "v0.1.0" },
    });
    expect(Health.parse(health)).toEqual({
      ok: true,
      version: "v0.1.0",
      db: "ok",
      readings: "none",
    });
  });

  it("falls back to dev when no version is set", async () => {
    const health = await computeHealth({ db: fakeDb({}), now: () => NOW, env: {} });
    expect(health.version).toBe("dev");
  });

  it("says fresh for a reading in the last 35 minutes, stale after, and carries no timestamp or value", async () => {
    expect(FRESH_READING_MINUTES).toBe(35);
    const fresh = await computeHealth({
      db: fakeDb({ latest: minutesAgo(34) }),
      now: () => NOW,
      env: {},
    });
    expect(fresh.readings).toBe("fresh");
    const stale = await computeHealth({
      db: fakeDb({ latest: minutesAgo(36) }),
      now: () => NOW,
      env: {},
    });
    expect(stale.readings).toBe("stale");
    expect(Object.keys(stale).sort()).toEqual(["db", "ok", "readings", "version"]);
    expect(JSON.stringify(stale)).not.toContain("2026-10-15T07");
  });

  it("reports db error and ok false, with readings none, when Prisma cannot query, and logs why without the message", async () => {
    const lines: string[] = [];
    const logger = createLogger(
      (line) => lines.push(line),
      () => NOW,
    );
    const health = await computeHealth({
      db: fakeDb({ fails: true }),
      now: () => NOW,
      env: {},
      logger,
    });
    expect(health).toEqual({ ok: false, version: "dev", db: "error", readings: "none" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      ts: NOW.toISOString(),
      level: "error",
      msg: "health: database check failed",
      route: "/api/health",
      error: "Error",
    });
    // A connection string in a Prisma message must not reach the log.
    expect(lines[0]).not.toContain("no db");
  });

  it("logs nothing when the database answers", async () => {
    const lines: string[] = [];
    await computeHealth({
      db: fakeDb({}),
      now: () => NOW,
      env: {},
      logger: createLogger((line) => lines.push(line)),
    });
    expect(lines).toEqual([]);
  });
});
