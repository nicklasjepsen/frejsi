import { createLogger } from "@naensom/shared";
import { describe, expect, it } from "vitest";

import type { ApnsRequest, ApnsResult } from "./apns";
import { DEFAULT_ATTRIBUTES, type Entry } from "./payloads";
import {
  CSV_HEADER,
  DEFAULT_RESTART_AFTER_MS,
  initialState,
  pushTestTick,
  type PushTestOptions,
} from "./push-test-run";

const ACTIVITY = "aa".repeat(32);
const NEXT_ACTIVITY = "bb".repeat(32);
const PUSH_TO_START = "cc".repeat(32);
const START = Date.parse("2026-11-08T20:00:00Z");
const MIN = 60_000;

function harness(options: Partial<PushTestOptions> = {}) {
  let now = START;
  let entries: Entry[] = [];
  let token: string | undefined = ACTIVITY;
  let replies: (ApnsResult | Error)[] = [];
  const sent: ApnsRequest[] = [];
  const csv: string[] = [];
  const lines: string[] = [];
  const state = initialState(START);
  const opts: PushTestOptions = {
    pushToStartToken: PUSH_TO_START,
    attributes: DEFAULT_ATTRIBUTES,
    restartAfterMs: DEFAULT_RESTART_AFTER_MS,
    priority: 10,
    ...options,
  };
  const deps = {
    readLatest: () => Promise.resolve(entries),
    send: (r: ApnsRequest) => {
      sent.push(r);
      const reply = replies.shift() ?? { status: 200, apnsId: "id" };
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
    activityToken: () => Promise.resolve(token),
    writeCsv: (line: string) => csv.push(line),
    now: () => now,
    log: createLogger((line) => lines.push(line)),
  };
  return {
    state,
    sent,
    csv,
    lines,
    tick: () => pushTestTick(deps, opts, state),
    at: (ms: number) => {
      now = ms;
    },
    reading: (ms: number, mgdl: number) => {
      entries = [{ date: ms, mgdl, direction: "Flat" }, ...entries].slice(0, 2);
    },
    setToken: (t: string | undefined) => {
      token = t;
    },
    reply: (...r: (ApnsResult | Error)[]) => {
      replies = r;
    },
  };
}

const events = (sent: ApnsRequest[]) =>
  sent.map((r) => (r.payload as { aps: { event: string } }).aps.event);

describe("pushTestTick", () => {
  it("pushes each new reading once, to the activity token, with its change", async () => {
    const h = harness();
    h.reading(START - 2 * MIN, 145);
    await h.tick();
    await h.tick();
    expect(h.sent).toHaveLength(1);

    h.reading(START + 3 * MIN, 151);
    h.at(START + 4 * MIN);
    await h.tick();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]?.deviceToken).toBe(ACTIVITY);
    expect(h.sent[1]?.pushType).toBe("liveactivity");
    const aps = (h.sent[1]?.payload as { aps: Record<string, unknown> }).aps;
    expect(aps["content-state"]).toEqual({
      mgdl: 151,
      direction: "Flat",
      delta: 6,
      readingAt: (START + 3 * MIN) / 1000,
    });
    expect(h.csv[1]).toBe(
      "2026-11-08T20:04:00.000Z,update,2026-11-08T20:03:00.000Z,60,151,Flat,6,200,,id",
    );
    expect(CSV_HEADER.split(",")).toHaveLength(h.csv[1]?.split(",").length ?? 0);
  });

  it("tries a reading again when the send could not connect", async () => {
    const h = harness();
    h.reading(START, 100);
    h.reply(new Error("APNs connection failed"));
    await h.tick();
    expect(h.csv).toHaveLength(0);
    await h.tick();
    expect(h.sent).toHaveLength(2);
    expect(h.csv).toHaveLength(1);
  });

  it("tries a reading again after Apple's 5xx or 429, not after a 4xx refusal", async () => {
    const h = harness();
    h.reading(START, 100);
    h.reply(
      { status: 503, reason: "ServiceUnavailable" },
      { status: 429, reason: "TooManyRequests" },
    );
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.sent).toHaveLength(3);
    await h.tick();
    expect(h.sent).toHaveLength(3);

    const g = harness();
    g.reading(START, 100);
    g.reply({ status: 410, reason: "Unregistered" });
    await g.tick();
    await g.tick();
    expect(g.sent).toHaveLength(1);
  });

  it("at 7 h 45 min ends the activity, starts a new one by push-to-start, then waits for its token", async () => {
    const h = harness();
    h.reading(START, 100);
    await h.tick();
    h.at(START + DEFAULT_RESTART_AFTER_MS);
    h.reading(START + DEFAULT_RESTART_AFTER_MS - MIN, 110);
    await h.tick();
    expect(events(h.sent)).toEqual(["update", "end", "start"]);
    expect(h.sent[1]?.deviceToken).toBe(ACTIVITY);
    expect(h.sent[2]?.deviceToken).toBe(PUSH_TO_START);
    expect(h.state.restarts).toBe(1);

    // The token file still names the ended activity: no update goes to it.
    h.reading(START + DEFAULT_RESTART_AFTER_MS + 4 * MIN, 120);
    h.at(START + DEFAULT_RESTART_AFTER_MS + 5 * MIN);
    await h.tick();
    expect(events(h.sent)).toHaveLength(3);
    expect(h.csv.at(-1)).toContain(",update-skipped,");

    // The new activity's token arrives: the reading it missed goes to it at once, then the next.
    h.setToken(NEXT_ACTIVITY);
    await h.tick();
    expect(h.sent.at(-1)?.deviceToken).toBe(NEXT_ACTIVITY);
    expect(events(h.sent).at(-1)).toBe("update");
    const missed = (h.sent.at(-1)?.payload as { aps: { "content-state": { mgdl: number } } }).aps;
    expect(missed["content-state"].mgdl).toBe(120);
    await h.tick();
    expect(h.sent).toHaveLength(4);
    h.reading(START + DEFAULT_RESTART_AFTER_MS + 9 * MIN, 125);
    h.at(START + DEFAULT_RESTART_AFTER_MS + 10 * MIN);
    await h.tick();
    expect(h.sent).toHaveLength(5);

    // And the next restart is 7 h 45 min after the first one.
    h.at(START + 2 * DEFAULT_RESTART_AFTER_MS - MIN);
    h.reading(START + 2 * DEFAULT_RESTART_AFTER_MS - 2 * MIN, 130);
    await h.tick();
    expect(events(h.sent).at(-1)).toBe("update");
  });

  it("tries push-to-start again after Apple's 5xx", async () => {
    const h = harness();
    h.reading(START, 100);
    h.at(START + DEFAULT_RESTART_AFTER_MS);
    h.reply({ status: 200 }, { status: 500, reason: "InternalServerError" });
    await h.tick();
    expect(h.state.restarts).toBe(0);
    await h.tick();
    expect(events(h.sent)).toEqual(["end", "start", "start"]);
    expect(h.state.restarts).toBe(1);
  });

  it("tries push-to-start again when it could not connect", async () => {
    const h = harness();
    h.reading(START, 100);
    h.at(START + DEFAULT_RESTART_AFTER_MS);
    h.reply({ status: 200 }, new Error("APNs connection failed"));
    await h.tick();
    expect(h.state.restarts).toBe(0);
    await h.tick();
    expect(events(h.sent)).toEqual(["end", "start", "start"]);
    expect(h.state.restarts).toBe(1);
  });

  it("keeps updating past the restart time when it has no push-to-start token", async () => {
    const h = harness({ pushToStartToken: undefined });
    h.at(START + DEFAULT_RESTART_AFTER_MS);
    h.reading(START + DEFAULT_RESTART_AFTER_MS, 100);
    await h.tick();
    expect(events(h.sent)).toEqual(["update"]);
    expect(h.lines.join("\n")).toContain("no-push-to-start-token");
  });

  it("logs codes only: no token, value or address", async () => {
    const h = harness();
    h.reading(START, 187);
    h.reply({ status: 400, reason: "BadDeviceToken" });
    await h.tick();
    const out = h.lines.join("\n");
    expect(out).toContain("update:400:BadDeviceToken");
    expect(out).not.toContain(ACTIVITY);
    expect(out).not.toContain("187");
  });
});
