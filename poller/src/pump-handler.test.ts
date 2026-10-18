import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createLogger,
  pumpSecretName,
  serializeNightscoutCredential,
  type FetchLike,
  type PumpCycleDeps,
  type PumpDb,
  type PumpSpaceOutcome,
} from "@frejsi/shared";
import { MemoryEventSink } from "@frejsi/shared/events/memory";
import { MemorySecrets } from "@frejsi/shared/secrets/memory";
import { describe, expect, it } from "vitest";

import { SCHEDULE } from "./poll-handler";
import { createPumpHandler, PUMP_JITTER_MAX_MS, PUMP_SCHEDULE, pumpJitterMs } from "./pump-handler";
import { createPumpSourceFactory } from "./sources";

describe("the pump-poll timer", () => {
  it("runs at second 0 of every fifteenth minute, apart from the glucose poll", () => {
    expect(PUMP_SCHEDULE).toBe("0 */15 * * * *");
    expect(PUMP_SCHEDULE).not.toBe(SCHEDULE);
  });

  it("jitters between 0 and 20 seconds", () => {
    expect(PUMP_JITTER_MAX_MS).toBe(20_000);
    expect(pumpJitterMs(() => 0)).toBe(0);
    expect(pumpJitterMs(() => 0.5)).toBe(10_000);
    expect(pumpJitterMs(() => 0.999999)).toBeLessThan(20_000);
    for (let i = 0; i < 50; i += 1) {
      const ms = pumpJitterMs();
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(PUMP_JITTER_MAX_MS);
    }
  });
});

const outcome = (spaceId: string, fields: Partial<PumpSpaceOutcome> = {}): PumpSpaceOutcome => ({
  spaceId,
  outcome: "ok",
  code: "ok",
  stored: 0,
  mealsCreated: 0,
  status: "connected",
  ...fields,
});

function harness(outcomes: PumpSpaceOutcome[]) {
  const lines: string[] = [];
  const sleeps: number[] = [];
  const order: string[] = [];
  let cycles = 0;
  const handler = createPumpHandler({
    runCycle: () => {
      cycles += 1;
      order.push("cycle");
      return Promise.resolve(outcomes);
    },
    cycleDeps: { db: {} as PumpDb, sources: () => Promise.reject(new Error("unused")) },
    sleep: (ms) => {
      sleeps.push(ms);
      order.push("sleep");
      return Promise.resolve();
    },
    random: () => 0.25,
    clock: () => 1_000,
    log: createLogger((line) => lines.push(line)),
  });
  return {
    run: () => handler({} as never, {} as never),
    lines,
    sleeps,
    order,
    cycles: () => cycles,
  };
}

describe("createPumpHandler", () => {
  it("waits its jitter, runs one cycle and logs one pump.cycle line with counts and codes", async () => {
    const h = harness([
      outcome("s1", { stored: 3, mealsCreated: 1 }),
      outcome("s2", { stored: 2 }),
    ]);
    await h.run();
    expect(h.order).toEqual(["sleep", "cycle"]);
    expect(h.sleeps).toEqual([5_000]);
    expect(h.cycles()).toBe(1);
    const lines = h.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map(({ ts: _ts, ...rest }) => rest)).toEqual([
      { level: "info", msg: "pump.cycle", count: 5, code: "ok", ms: 0 },
    ]);
  });

  it("warns with how many spaces failed", async () => {
    const h = harness([
      outcome("s1"),
      outcome("s2", { outcome: "failed", code: "fetch-failed" }),
      outcome("s3", { outcome: "failed", code: "store-failed" }),
    ]);
    await h.run();
    expect(h.lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      expect.objectContaining({ level: "warn", msg: "pump.cycle", code: "2-failed", count: 0 }),
    ]);
  });
});

describe("a full pump cycle's log lines", () => {
  const fixture = (name: string): string =>
    readFileSync(path.resolve(import.meta.dirname, "../../fixtures/nightscout", name), "utf8");
  const NOW = new Date("2026-10-15T18:00:00.000Z");
  const ADDRESS = "https://example-ns.example.invalid";
  const TOKEN = "<fixture-pump-token>";

  it("carry space ids, counts and codes only: no address, token, units or carbs", async () => {
    const secrets = new MemorySecrets();
    const okRef = await secrets.set(
      pumpSecretName("s-ok"),
      serializeNightscoutCredential({ url: ADDRESS, token: TOKEN }),
    );
    const refusedRef = await secrets.set(
      pumpSecretName("s-refused"),
      serializeNightscoutCredential({ url: `${ADDRESS}/refused`, token: TOKEN }),
    );
    const fetch: FetchLike = (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/refused")) {
        return Promise.resolve(
          new Response(`{"message":"${TOKEN} not valid for ${ADDRESS}"}`, { status: 401 }),
        );
      }
      return Promise.resolve(new Response(fixture("treatments-combo-bolus.json"), { status: 200 }));
    };
    const spaces = [
      { id: "s-ok", ref: okRef },
      { id: "s-refused", ref: refusedRef },
    ].map(({ id, ref }) => ({
      id,
      pumpSource: JSON.stringify({ type: "nightscout", secretRef: ref, connectedBy: "u1" }),
      pumpStatus: "connected",
      pumpFailures: 0,
      lastPumpAt: null,
    }));
    // The writes fail, so every stage of the cycle logs: fetch, store and status.
    const db = {
      space: {
        findMany: () => Promise.resolve(spaces),
        update: () => Promise.resolve({ pumpFailures: 1, pumpStatus: "connected" }),
      },
      pumpBolus: { findMany: () => Promise.resolve([]) },
      user: { findUnique: () => Promise.resolve({ locale: "da" }) },
      $transaction: () => Promise.reject(new Error(`database down near ${ADDRESS}`)),
    } as unknown as PumpDb;
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    const cycleDeps: Pick<PumpCycleDeps, "db" | "sources" | "sink"> & { now: () => Date } = {
      db,
      sources: createPumpSourceFactory({ secrets, fetch, log, now: () => NOW }),
      sink: new MemoryEventSink(),
      now: () => NOW,
    };
    await createPumpHandler({ cycleDeps, sleep: () => Promise.resolve(), clock: () => 0, log })(
      {} as never,
      {} as never,
    );

    expect(lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toContain("pump.cycle");
    const allowed = ["ts", "level", "msg", "spaceId", "count", "code", "ms", "error"];
    for (const line of lines) {
      for (const key of Object.keys(JSON.parse(line) as object))
        expect(allowed, line).toContain(key);
    }
    const output = lines.join("\n");
    expect(output).toContain('"spaceId":"s-ok"');
    expect(output).toContain('"spaceId":"s-refused"');
    expect(output).toContain('"code":"401"');
    expect(output).not.toMatch(/example-ns|fixture-pump-token|refused\//);
    // The fixture's units (2.4, 1.5, 0.6, 0.5, 1, 3) and carbs (45, 20, 60) are nowhere.
    expect(output).not.toMatch(/2\.4|1\.5|0\.6|0\.5|":45|":20|":60|units|carbs|insulin/);
  });
});
