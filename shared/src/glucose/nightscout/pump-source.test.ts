import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import { createLogger } from "../../log";
import { PumpBolus } from "../../schemas/pump";
import type { PumpSource } from "../../pump/types";
import { FIRST_RUN_PAGE_COUNT, MAX_PAGES, PAGE_COUNT } from "./protocol";
import { NightscoutPumpSource } from "./pump-source";
import { NightscoutError } from "./source";
import type { FetchLike } from "./transport";

const fixturesDir = path.resolve(import.meta.dirname, "../../../../fixtures/nightscout");
const fixture = (name: string): string => readFileSync(path.join(fixturesDir, name), "utf8");

const BASE = "https://example-ns.example.invalid";
const SECRET_TOKEN = "fixture-token-xyz";
const API_SECRET = "fixture-api-secret";
/** Nightscout's API_SECRET convention: the SHA-1 hex of the secret, worked out once for the fixture. */
const API_SECRET_SHA1 = "af81e13f7ffb8e0e875502e0ec7b9de82d0f88be";
const now = new Date("2026-10-15T18:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Call {
  url: URL;
  headers: Record<string, string>;
  method: string;
  redirect: string | undefined;
  body: string | undefined;
}

type Answer = { status?: number; body?: string } | Error | "hang";

/** A fetch that answers each call in turn (the last answer repeats) and records every request. */
function recording(answers: Answer | ((call: Call, index: number) => Answer)) {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      url: new URL(String(input)),
      headers: init?.headers ?? {},
      method: init?.method ?? "GET",
      redirect: init?.redirect,
      body: init?.body,
    };
    calls.push(call);
    const answer = typeof answers === "function" ? answers(call, calls.length - 1) : answers;
    if (answer === "hang") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    if (answer instanceof Error) return Promise.reject(answer);
    const status = answer.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(answer.body ?? ""),
    });
  };
  return { fetch, calls };
}

function pump(
  answers: Parameters<typeof recording>[0],
  options: Partial<ConstructorParameters<typeof NightscoutPumpSource>[0]> = {},
) {
  const r = recording(answers);
  const lines: string[] = [];
  const source = new NightscoutPumpSource({
    url: BASE,
    token: SECRET_TOKEN,
    fetch: r.fetch,
    now: () => now,
    log: createLogger(
      (line) => lines.push(line),
      () => now,
    ),
    ...options,
  });
  return { source, ...r, lines };
}

/** A full page of fictional Combo Bolus records, newest first, an hour apart from `newest`. */
function page(size: number, newest: Date, firstId: number): string {
  return JSON.stringify(
    Array.from({ length: size }, (_, i) => ({
      eventType: "Combo Bolus",
      created_at: new Date(newest.getTime() - i * 60_000).toISOString(),
      insulin: 1,
      notes: "Automatic Bolus",
      pump_event_id: String(firstId + i),
    })),
  );
}

describe("NightscoutPumpSource", () => {
  it("implements PumpSource", () => {
    expectTypeOf<NightscoutPumpSource>().toExtend<PumpSource>();
  });
});

describe("NightscoutPumpSource.fetchBolusesSince", () => {
  it("asks treatments.json for Combo Bolus records since the window, 200 on a normal window", async () => {
    const h = pump({ body: "[]" });
    const since = new Date(now.getTime() - DAY);
    await h.source.fetchBolusesSince(since);
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    expect(call?.method).toBe("GET");
    expect(call?.body).toBeUndefined();
    expect(`${call?.url.origin}${call?.url.pathname}`).toBe(`${BASE}/api/v1/treatments.json`);
    expect(call?.url.searchParams.get("find[created_at][$gte]")).toBe(since.toISOString());
    expect(call?.url.searchParams.get("find[eventType]")).toBe("Combo Bolus");
    expect(call?.url.searchParams.get("count")).toBe(String(PAGE_COUNT));
    expect(PAGE_COUNT).toBe(200);
    expect([...(call?.url.searchParams.keys() ?? [])].sort()).toEqual([
      "count",
      "find[created_at][$gte]",
      "find[eventType]",
    ]);
  });

  it("asks for 1000 on a first run's fourteen days", async () => {
    const h = pump({ body: "[]" });
    await h.source.fetchBolusesSince(new Date(now.getTime() - 14 * DAY));
    expect(h.calls[0]?.url.searchParams.get("count")).toBe(String(FIRST_RUN_PAGE_COUNT));
    expect(FIRST_RUN_PAGE_COUNT).toBe(1000);
  });

  it("sends the token in api-secret and never in the URL, and follows no redirect", async () => {
    const h = pump({ body: "[]" });
    await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    expect(h.calls[0]?.headers["api-secret"]).toBe(SECRET_TOKEN);
    expect(h.calls[0]?.url.href).not.toContain(SECRET_TOKEN);
    expect(h.calls[0]?.redirect).toBe("manual");
  });

  it("sends the SHA-1 hex of an API secret, never the secret", async () => {
    const h = pump({ body: "[]" }, { token: undefined, apiSecret: API_SECRET });
    await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    const hash = API_SECRET_SHA1;
    expect(h.calls[0]?.headers["api-secret"]).toBe(hash);
    expect(h.calls[0]?.url.href).not.toContain(API_SECRET);
    expect(h.calls[0]?.url.href).not.toContain(hash);
  });

  it("maps the fixture to one bolus per pump_event_id, oldest first, with its kind, units and carbs", async () => {
    const h = pump({ body: fixture("treatments-combo-bolus.json") });
    const boluses = await h.source.fetchBolusesSince(new Date("2026-10-15T00:00:00.000Z"));
    expect(boluses).toEqual([
      { sourceId: "5001", ts: "2026-10-15T03:10:00.000Z", units: 0.6, kind: "automatic" },
      {
        sourceId: "5002",
        ts: "2026-10-15T09:58:00.000Z",
        units: 2.4,
        kind: "standard",
        carbs: 45,
      },
      {
        sourceId: "5003",
        ts: "2026-10-15T11:58:00.000Z",
        units: 1.5,
        kind: "standard",
        carbs: 20,
      },
      { sourceId: "5006", ts: "2026-10-15T13:00:00.000Z", units: 0.5, kind: "other" },
      { sourceId: "5004", ts: "2026-10-15T14:30:00.000Z", units: 1, kind: "standard" },
      {
        sourceId: "5005",
        ts: "2026-10-15T17:00:00.000Z",
        units: 3,
        kind: "extended",
        carbs: 60,
      },
    ]);
  });

  it("keeps a bolus without carbs when its carbs are outside the contract", async () => {
    const row = (id: string, carbs: number) => ({
      eventType: "Combo Bolus",
      created_at: "2026-10-15T12:00:00.000Z",
      insulin: 2,
      notes: "Standard Bolus",
      carbs,
      pump_event_id: id,
    });
    const h = pump({
      body: JSON.stringify([row("small", 0.4), row("large", 1200), row("fraction", 12.6)]),
    });
    const boluses = await h.source.fetchBolusesSince(new Date("2026-10-15T00:00:00.000Z"));
    expect(boluses).toEqual([
      {
        sourceId: "fraction",
        ts: "2026-10-15T12:00:00.000Z",
        units: 2,
        kind: "standard",
        carbs: 13,
      },
      { sourceId: "large", ts: "2026-10-15T12:00:00.000Z", units: 2, kind: "standard" },
      { sourceId: "small", ts: "2026-10-15T12:00:00.000Z", units: 2, kind: "standard" },
    ]);
    expect(h.lines.join("\n")).not.toContain("pump.dropped");
  });

  it("returns no key besides sourceId, ts, units, kind and carbs, and every bolus is a PumpBolus", async () => {
    const h = pump({ body: fixture("treatments-combo-bolus.json") });
    const boluses = await h.source.fetchBolusesSince(new Date("2026-10-15T00:00:00.000Z"));
    const allowed = ["carbs", "kind", "sourceId", "ts", "units"];
    for (const bolus of boluses) {
      for (const key of Object.keys(bolus)) expect(allowed).toContain(key);
      expect(PumpBolus.parse(bolus)).toEqual(bolus);
    }
    expect(JSON.stringify(boluses)).not.toMatch(/glucose|enteredBy|utcOffset|_id|fictional/);
  });

  it("ignores the Temp Basal row without counting it as dropped", async () => {
    const h = pump({ body: fixture("treatments-combo-bolus.json") });
    const boluses = await h.source.fetchBolusesSince(new Date("2026-10-15T00:00:00.000Z"));
    expect(boluses.map((b) => b.sourceId)).not.toContain("5900");
    expect(h.lines.join("\n")).not.toContain("pump.dropped");
  });

  it("drops malformed rows and reports how many in one pump.dropped line", async () => {
    const h = pump({ body: fixture("treatments-malformed.json") });
    const boluses = await h.source.fetchBolusesSince(new Date("2026-10-15T00:00:00.000Z"));
    expect(boluses).toEqual([
      {
        sourceId: "6005",
        ts: "2026-10-15T12:00:00.000Z",
        units: 2,
        kind: "standard",
        carbs: 30,
      },
    ]);
    const dropped = h.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(dropped).toEqual([
      expect.objectContaining({ level: "warn", msg: "pump.dropped", count: 5 }),
    ]);
  });

  it("returns nothing for an empty answer and records before since", async () => {
    expect(
      await pump({ body: fixture("treatments-empty.json") }).source.fetchBolusesSince(
        new Date(now.getTime() - DAY),
      ),
    ).toEqual([]);
    const late = pump({ body: fixture("treatments-combo-bolus.json") });
    const boluses = await late.source.fetchBolusesSince(new Date("2026-10-15T14:30:00.000Z"));
    expect(boluses.map((b) => b.sourceId)).toEqual(["5004", "5005"]);
  });

  it("keeps paging below the oldest record seen while a page is full", async () => {
    const newest = new Date(now.getTime() - HOUR);
    const h = pump((call, index) => {
      if (index === 0) return { body: page(PAGE_COUNT, newest, 1) };
      const lte = call.url.searchParams.get("find[created_at][$lte]") ?? "";
      return { body: page(3, new Date(Date.parse(lte) - 60_000), 1000) };
    });
    const boluses = await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    expect(h.calls).toHaveLength(2);
    const oldestOfFirst = new Date(newest.getTime() - (PAGE_COUNT - 1) * 60_000).toISOString();
    expect(h.calls[1]?.url.searchParams.get("find[created_at][$lte]")).toBe(oldestOfFirst);
    expect(h.calls[1]?.url.searchParams.get("find[created_at][$gte]")).toBe(
      new Date(now.getTime() - DAY).toISOString(),
    );
    expect(boluses).toHaveLength(PAGE_COUNT + 3);
    const times = boluses.map((b) => Date.parse(b.ts));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(h.lines.join("\n")).not.toContain("pump.page-cap");
  });

  it("asks $lte the oldest seen, so a record sharing that time beyond a full page is kept once", async () => {
    const newest = new Date(now.getTime() - HOUR);
    const full = JSON.parse(page(PAGE_COUNT, newest, 1)) as Record<string, unknown>[];
    const oldest = full[full.length - 1];
    if (!oldest) throw new Error("no page");
    // The record beyond the page shares the oldest time; Nightscout repeats the boundary record.
    const twin = { ...oldest, pump_event_id: "twin" };
    const older = {
      ...oldest,
      created_at: new Date(Date.parse(String(oldest.created_at)) - 60_000).toISOString(),
      pump_event_id: "older",
    };
    const h = pump((_call, index) =>
      index === 0
        ? { body: JSON.stringify(full) }
        : { body: JSON.stringify([oldest, twin, older]) },
    );
    const boluses = await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]?.url.searchParams.get("find[created_at][$lte]")).toBe(oldest.created_at);
    expect(h.calls[1]?.url.searchParams.has("find[created_at][$lt]")).toBe(false);
    const ids = boluses.map((b) => b.sourceId);
    expect(ids).toContain("twin");
    expect(ids).toContain("older");
    expect(ids.filter((id) => id === oldest.pump_event_id)).toHaveLength(1);
    expect(boluses).toHaveLength(PAGE_COUNT + 2);
  });

  it("keeps paging past a full page of unreadable records while the time still moves", async () => {
    const newest = new Date(now.getTime() - HOUR);
    const first = page(PAGE_COUNT, newest, 1);
    // The second page is full of records that cannot be read, a minute apart: nothing new, but
    // the cursor moves, so the valid records below them are still read.
    const unreadable = (from: Date) =>
      JSON.stringify(
        (JSON.parse(page(PAGE_COUNT, from, 5000)) as Record<string, unknown>[]).map((row) => ({
          ...row,
          insulin: "1",
        })),
      );
    const h = pump((call, index) => {
      const lte = Date.parse(call.url.searchParams.get("find[created_at][$lte]") ?? "");
      if (index === 0) return { body: first };
      if (index === 1) return { body: unreadable(new Date(lte - 60_000)) };
      return { body: page(2, new Date(lte - 60_000), 9000) };
    });
    const boluses = await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    expect(h.calls).toHaveLength(3);
    expect(boluses.map((b) => b.sourceId)).toEqual(expect.arrayContaining(["9000", "9001"]));
    expect(boluses).toHaveLength(PAGE_COUNT + 2);
  });

  it("stops paging when a full page sits at the cursor's own time", async () => {
    const newest = new Date(now.getTime() - HOUR);
    // Every record at one time: $lte cannot move past them, so the same page comes back.
    const same = JSON.stringify(
      Array.from({ length: PAGE_COUNT }, (_, i) => ({
        eventType: "Combo Bolus",
        created_at: newest.toISOString(),
        insulin: 1,
        notes: "Automatic Bolus",
        pump_event_id: String(i + 1),
      })),
    );
    const h = pump({ body: same });
    const boluses = await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    expect(h.calls).toHaveLength(2);
    expect(boluses).toHaveLength(PAGE_COUNT);
  });

  it("counts an unreadable record at the page boundary once, though the next page repeats it", async () => {
    const newest = new Date(now.getTime() - HOUR);
    const full = JSON.parse(page(PAGE_COUNT, newest, 1)) as Record<string, unknown>[];
    const last = full[full.length - 1];
    if (!last) throw new Error("no page");
    // The oldest record of the full page has no pump_event_id; $lte returns it again.
    const { pump_event_id: _id, ...unreadable } = last;
    full[full.length - 1] = unreadable;
    const older = {
      ...last,
      created_at: new Date(Date.parse(String(last.created_at)) - 60_000).toISOString(),
      pump_event_id: "older",
    };
    const h = pump((_call, index) =>
      index === 0
        ? { body: JSON.stringify(full) }
        : { body: JSON.stringify([unreadable, older]) },
    );
    const boluses = await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    expect(h.calls).toHaveLength(2);
    expect(boluses).toHaveLength(PAGE_COUNT);
    const lines = h.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([
      expect.objectContaining({ level: "warn", msg: "pump.dropped", count: 1 }),
    ]);
  });

  it("counts a full page of unreadable records at the cursor's own time once", async () => {
    const newest = new Date(now.getTime() - HOUR);
    const same = JSON.stringify(
      Array.from({ length: PAGE_COUNT }, (_, i) => ({
        eventType: "Combo Bolus",
        created_at: newest.toISOString(),
        insulin: "1",
        notes: "Automatic Bolus",
        pump_event_id: String(i + 1),
      })),
    );
    const h = pump({ body: same });
    const boluses = await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    expect(h.calls).toHaveLength(2);
    expect(boluses).toEqual([]);
    const lines = h.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([
      expect.objectContaining({ level: "warn", msg: "pump.dropped", count: PAGE_COUNT }),
    ]);
  });

  it("stops after five full pages and logs the sixth as pump.page-cap", async () => {
    const h = pump((call) => {
      const lte = call.url.searchParams.get("find[created_at][$lte]");
      const newest =
        lte === null ? new Date(now.getTime() - HOUR) : new Date(Date.parse(lte) - 1000);
      return { body: page(PAGE_COUNT, newest, Math.floor(newest.getTime() / 1000)) };
    });
    const boluses = await h.source.fetchBolusesSince(new Date(now.getTime() - DAY));
    expect(MAX_PAGES).toBe(5);
    expect(h.calls).toHaveLength(MAX_PAGES);
    expect(boluses.length).toBeGreaterThan(0);
    expect(h.lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toContain("pump.page-cap");
  });

  it("fails with the HTTP status as the code on 401, and no URL, token or body anywhere", async () => {
    const h = pump({ status: 401, body: `{"message":"secret ${SECRET_TOKEN} ${BASE}"}` });
    const error = await h.source
      .fetchBolusesSince(new Date(now.getTime() - DAY))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NightscoutError);
    expect((error as NightscoutError).code).toBe("401");
    expect((error as Error).message).not.toMatch(/example-ns|fixture-token/);
    expect(h.lines.join("\n")).not.toMatch(/example-ns|fixture-token|secret/);
  });

  it("fails with UnexpectedShape, Timeout and Network, carrying no address", async () => {
    const since = new Date(now.getTime() - DAY);
    const shape = await pump({ body: '{"a":1}' })
      .source.fetchBolusesSince(since)
      .catch((e: unknown) => e);
    expect((shape as NightscoutError).code).toBe("UnexpectedShape");
    const slow = await pump("hang", { timeoutMs: 20 })
      .source.fetchBolusesSince(since)
      .catch((e: unknown) => e);
    expect((slow as NightscoutError).code).toBe("Timeout");
    const down = await pump(new TypeError(`fetch failed ${BASE}`))
      .source.fetchBolusesSince(since)
      .catch((e: unknown) => e);
    expect((down as NightscoutError).code).toBe("Network");
    expect((down as Error).message).not.toContain("example-ns");
  });
});

describe("NightscoutPumpSource.probe", () => {
  it("asks verifyauth with GET and reads its verdict like the glucose adapter", async () => {
    const ok = pump({ body: fixture("verifyauth-ok.json") });
    expect(await ok.source.probe()).toBe("ok");
    expect(ok.calls[0]?.method).toBe("GET");
    expect(ok.calls[0]?.url.pathname).toBe("/api/v1/verifyauth");
    expect(await pump({ body: fixture("verifyauth-unauthorized.json") }).source.probe()).toBe(
      "bad-credentials",
    );
    expect(await pump({ status: 403 }).source.probe()).toBe("bad-credentials");
    expect(await pump(new TypeError("fetch failed")).source.probe()).toBe("unreachable");
  });
});

/** Every function member of an instance and its prototypes, as in glucose/read-only.test.ts. */
function functionMembers(instance: object): string[] {
  const names = new Set<string>();
  for (
    let o: object | null = instance;
    o && o !== Object.prototype;
    o = Object.getPrototypeOf(o) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name === "constructor") continue;
      if (typeof Object.getOwnPropertyDescriptor(o, name)?.value === "function") names.add(name);
    }
  }
  return [...names].sort();
}

describe("the pump source is read-only", () => {
  it("has no function member beyond its listed read steps", () => {
    const { source } = pump({ body: "[]" });
    expect(functionMembers(source)).toEqual(
      [
        "fetchBolusesSince",
        "probe",
        "readPage", // one allow-listed GET of treatments.json
        "fetch", // the injected fetch; only the transport calls it (lint)
        "now", // the injected clock
      ].sort(),
    );
    for (const member of functionMembers(source)) {
      expect(member).not.toMatch(
        /^(post|put|patch|delete|remove|create|update|upload|send|write|set|add|replace)/i,
      );
    }
  });
});
