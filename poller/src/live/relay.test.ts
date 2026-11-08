import {
  createLogger,
  liveSecretName,
  NightscoutError,
  serializeNightscoutCredential,
  type FetchLike,
  type NightscoutEntry,
} from "@naensom/shared";
import { MemorySecrets } from "@naensom/shared/secrets/memory";
import { describe, expect, it } from "vitest";

import type { ApnsEnvironment, ApnsRequest, ApnsResult } from "./apns";
import {
  CHECK_CONCURRENCY,
  checkSubscription,
  createApnsSenders,
  createEntryReader,
  IDLE_AFTER_MS,
  mapLimit,
  ORPHAN_GRACE_MS,
  runLivePoll,
  verdictOf,
  type RelayDeps,
} from "./relay";
import { FIRST_CHECK_AFTER_MS, RESTART_AFTER_MS } from "./schedule";
import { MemoryLiveStore, type LiveRow } from "./store";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);
const min = 60_000;
const ACTIVITY = "a1".repeat(32);
const START = "b2".repeat(32);
const DEVICE = "c3".repeat(32);
const SITE = "https://ns.example.org";

function row(fields: Partial<LiveRow> = {}): LiveRow {
  return {
    id: "sub-0001",
    deviceSecretHash: "0".repeat(64),
    isDemo: false,
    nightscoutHost: "ns.example.org",
    tokenSecretRef: `${liveSecretName("sub-0001")}/1`,
    apnsEnvironment: "production",
    pushToStartToken: START,
    activityPushToken: ACTIVITY,
    activityStartedAt: new Date(T0 - 60 * min),
    deviceToken: DEVICE,
    unit: "mmolL",
    language: "da",
    urgentLowMgdl: 55,
    lowMgdl: 80,
    highMgdl: 180,
    urgentHighMgdl: 260,
    alertsOn: true,
    lastAlertKind: null,
    lastAlertAt: null,
    lastReadingAt: null,
    lastPushAt: null,
    nextCheckAt: new Date(T0),
    failures: 0,
    createdAt: new Date(T0 - 120 * min),
    lastSeenAt: new Date(T0 - 120 * min),
    ...fields,
  };
}

const entry = (ageMin: number, mgdl: number, direction = "Flat"): NightscoutEntry => ({
  date: T0 - ageMin * min,
  mgdl,
  direction,
});

interface Sent {
  environment: ApnsEnvironment;
  request: ApnsRequest;
}

function harness(
  rows: LiveRow[],
  options: {
    entries?: NightscoutEntry[] | Error;
    respond?: (request: ApnsRequest) => ApnsResult | Error;
  } = {},
) {
  let now = T0;
  const store = new MemoryLiveStore();
  for (const r of rows) store.rows.set(r.id, { ...r });
  const secrets = new MemorySecrets(
    Object.fromEntries(
      rows.map((r) => [
        liveSecretName(r.id),
        serializeNightscoutCredential({ url: SITE, token: "fixture-token" }),
      ]),
    ),
    () => now,
  );
  const lines: string[] = [];
  const sent: Sent[] = [];
  let entries = options.entries ?? [entry(1, 120), entry(6, 115)];
  const deps: RelayDeps = {
    store,
    secrets,
    readEntries: () =>
      entries instanceof Error ? Promise.reject(entries) : Promise.resolve(entries),
    send: (environment: ApnsEnvironment, request: ApnsRequest) => {
      sent.push({ environment, request });
      const answer = options.respond?.(request) ?? { status: 200, apnsId: "id" };
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    now: () => now,
    log: createLogger(
      (line) => lines.push(line),
      () => new Date(T0),
    ),
  };
  return {
    deps,
    store,
    secrets,
    lines,
    sent,
    setNow: (value: number) => {
      now = value;
    },
    setEntries: (value: NightscoutEntry[] | Error) => {
      entries = value;
    },
    get: (id = "sub-0001") => store.rows.get(id),
  };
}

const messages = (lines: string[]) =>
  lines.map((line) => (JSON.parse(line) as { msg: string }).msg);

/** Makes the next `count` secret deletes fail; answers how many deletes were asked for. */
function failDeletes(h: ReturnType<typeof harness>, count: number) {
  const remove = h.secrets.delete.bind(h.secrets);
  const calls = { asked: 0 };
  h.secrets.delete = (name) => {
    calls.asked += 1;
    if (calls.asked <= count) return Promise.reject(new Error("vault unavailable"));
    return remove(name);
  };
  return calls;
}

const aps = (s: Sent) => (s.request.payload as { aps: Record<string, unknown> }).aps;

describe("checkSubscription: the Live Activity update", () => {
  it("sends one update for a new reading and schedules the next at reading + 5 min 15 s", async () => {
    const h = harness([row({ deviceToken: null })]);
    await expect(checkSubscription(h.deps, row({ deviceToken: null }))).resolves.toBe("pushed");
    expect(h.sent).toHaveLength(1);
    const [update] = h.sent;
    expect(must(update).environment).toBe("production");
    expect(must(update).request).toMatchObject({
      deviceToken: ACTIVITY,
      pushType: "liveactivity",
      priority: 10,
    });
    const readingAt = Math.floor((T0 - min) / 1000);
    expect(aps(must(update))).toMatchObject({
      event: "update",
      "content-state": { mgdl: 120, direction: "Flat", delta: 5, readingAt },
      "stale-date": readingAt + 15 * 60,
    });
    expect(must(update).request.expiration).toBe(readingAt + 15 * 60);
    expect(h.get()).toMatchObject({
      lastReadingAt: new Date(T0 - min),
      lastPushAt: new Date(T0),
      lastSeenAt: new Date(T0),
      failures: 0,
      nextCheckAt: new Date(T0 - min + FIRST_CHECK_AFTER_MS),
    });
  });

  it("sends nothing when the newest reading is the one already pushed, and checks every minute", async () => {
    const r = row({ lastReadingAt: new Date(T0 - 6 * min), deviceToken: null });
    const h = harness([r], { entries: [entry(6, 115)] });
    await expect(checkSubscription(h.deps, r)).resolves.toBe("unchanged");
    expect(h.sent).toEqual([]);
    expect(h.get()?.nextCheckAt).toEqual(new Date(T0 + min));
    // Accepted nothing: lastSeenAt stays where it was.
    expect(h.get()?.lastSeenAt).toEqual(r.lastSeenAt);
  });

  it("tries an update Apple answered 5xx again on the next minute, then moves on", async () => {
    let status = 503;
    const r = row({ deviceToken: null });
    const h = harness([r], { respond: () => ({ status }) });
    await expect(checkSubscription(h.deps, r)).resolves.toBe("push-retry");
    expect(h.get()?.lastReadingAt).toBeNull();
    expect(h.get()?.nextCheckAt).toEqual(new Date(T0 + min));
    status = 200;
    h.setNow(T0 + min);
    await expect(checkSubscription(h.deps, must(h.get()))).resolves.toBe("pushed");
    expect(h.sent).toHaveLength(2);
    expect(h.get()?.lastReadingAt).toEqual(new Date(T0 - min));
  });

  it("leaves a registration that came in during the push to give the new activity the reading", async () => {
    const r = row({ deviceToken: null });
    const h = harness([r], {
      respond: () => {
        const current = must(h.store.rows.get(r.id));
        h.store.rows.set(r.id, {
          ...current,
          activityPushToken: "d4".repeat(32),
          lastReadingAt: null,
          nextCheckAt: new Date(T0),
        });
        return { status: 200 };
      },
    });
    await checkSubscription(h.deps, r);
    expect(h.get()).toMatchObject({
      activityPushToken: "d4".repeat(32),
      lastReadingAt: null,
      nextCheckAt: new Date(T0),
      lastSeenAt: new Date(T0),
    });
  });

  it("treats a send that threw like a 5xx", async () => {
    const r = row({ deviceToken: null });
    const h = harness([r], { respond: () => new Error("APNs connection failed") });
    await expect(checkSubscription(h.deps, r)).resolves.toBe("push-retry");
    expect(h.lines.join("\n")).toContain("update:send-failed");
  });

  it("only records the reading when there is no activity to push to", async () => {
    const r = row({ activityPushToken: null, activityStartedAt: null, deviceToken: null });
    const h = harness([r]);
    await expect(checkSubscription(h.deps, r)).resolves.toBe("unchanged");
    expect(h.sent).toEqual([]);
    expect(h.get()?.lastReadingAt).toEqual(new Date(T0 - min));
  });
});

describe("checkSubscription: the 8-hour restart", () => {
  const old = new Date(T0 - RESTART_AFTER_MS);

  it("at 7 h 45 min ends the activity, then starts a new one by push-to-start", async () => {
    const r = row({ activityStartedAt: old, deviceToken: null, unit: "mgdL", language: "en" });
    const h = harness([r]);
    await expect(checkSubscription(h.deps, r)).resolves.toBe("restarted");
    expect(h.sent.map((s) => [s.request.deviceToken, aps(s).event])).toEqual([
      [ACTIVITY, "end"],
      [START, "start"],
    ]);
    const start = aps(must(h.sent[1]));
    expect(start).toMatchObject({
      "input-push-token": 1,
      "attributes-type": "GlucoseActivityAttributes",
      attributes: { unit: "mgdL" },
      alert: { title: "Live Activity", body: "Restarted" },
    });
    // The old token is cleared until the app registers the new activity's.
    expect(h.get()).toMatchObject({
      activityPushToken: null,
      activityStartedAt: new Date(T0),
      lastReadingAt: new Date(T0 - min),
    });
  });

  it("restarts at 7 h 45 min even without a new reading", async () => {
    const r = row({ activityStartedAt: old, lastReadingAt: new Date(T0 - min), deviceToken: null });
    const h = harness([r]);
    await expect(checkSubscription(h.deps, r)).resolves.toBe("restarted");
    expect(h.sent.map((s) => aps(s).event)).toEqual(["end", "start"]);
  });

  it("keeps a new activity token the app registered while the restart was being sent", async () => {
    const r = row({ activityStartedAt: old, deviceToken: null });
    const h = harness([r], {
      respond: (request) => {
        if (request.deviceToken === START) {
          // The app re-registers between the relay's read and its write.
          const current = must(h.store.rows.get(r.id));
          h.store.rows.set(r.id, { ...current, activityPushToken: "d4".repeat(32) });
        }
        return { status: 200 };
      },
    });
    await checkSubscription(h.deps, r);
    expect(h.get()?.activityPushToken).toBe("d4".repeat(32));
  });

  it("tries a start Apple answered 5xx again next minute, without ending the activity twice", async () => {
    let status = 500;
    const r = row({ activityStartedAt: old, deviceToken: null });
    const h = harness([r], {
      respond: (request) => (request.deviceToken === START ? { status } : { status: 200 }),
    });
    await expect(checkSubscription(h.deps, r)).resolves.toBe("push-retry");
    expect(h.get()).toMatchObject({ activityPushToken: null, activityStartedAt: old });
    expect(h.get()?.nextCheckAt).toEqual(new Date(T0 + min));
    status = 200;
    h.setNow(T0 + min);
    await expect(checkSubscription(h.deps, must(h.get()))).resolves.toBe("restarted");
    expect(h.sent.map((s) => aps(s).event)).toEqual(["end", "start", "start"]);
  });

  it("stops trying when Apple refuses the start; the app offers tap to restart", async () => {
    const r = row({ activityStartedAt: old });
    const h = harness([r], {
      respond: (request) =>
        request.deviceToken === START ? { status: 400, reason: "BadPriority" } : { status: 200 },
    });
    await checkSubscription(h.deps, r);
    expect(h.get()).toMatchObject({ activityStartedAt: null, pushToStartToken: START });
  });

  it("does not restart without a push-to-start token", async () => {
    const r = row({ activityStartedAt: old, pushToStartToken: null, deviceToken: null });
    const h = harness([r]);
    await expect(checkSubscription(h.deps, r)).resolves.toBe("pushed");
    expect(h.sent.map((s) => aps(s).event)).toEqual(["update"]);
  });
});

describe("checkSubscription: low/high reminders", () => {
  it("sends a time-sensitive alert in the subscription's language, with the reading's age", async () => {
    const r = row({ activityPushToken: null, activityStartedAt: null });
    const h = harness([r], { entries: [entry(2, 65), entry(7, 72)] });
    await checkSubscription(h.deps, r);
    expect(h.sent).toHaveLength(1);
    const [alert] = h.sent;
    expect(must(alert).request).toMatchObject({
      deviceToken: DEVICE,
      pushType: "alert",
      priority: 10,
    });
    expect(aps(must(alert))).toMatchObject({
      alert: { title: "Lav: 3,6 mmol/L · 2 min siden" },
      "interruption-level": "time-sensitive",
    });
    expect(h.get()).toMatchObject({ lastAlertKind: "low", lastAlertAt: new Date(T0) });

    // Still low ten minutes later: no repeat yet.
    h.setEntries([entry(0, 66)]);
    h.setNow(T0 + 10 * min);
    await checkSubscription(h.deps, must(h.get()));
    expect(h.sent).toHaveLength(1);
    // Thirty minutes after the first: again.
    h.setNow(T0 + 30 * min);
    h.setEntries([{ date: T0 + 29 * min, mgdl: 64, direction: "Flat" }]);
    await checkSubscription(h.deps, must(h.get()));
    expect(h.sent).toHaveLength(2);
    // Back in range resets; the next crossing alerts at once.
    h.setNow(T0 + 35 * min);
    h.setEntries([{ date: T0 + 34 * min, mgdl: 100, direction: "Flat" }]);
    await checkSubscription(h.deps, must(h.get()));
    expect(h.get()?.lastAlertKind).toBeNull();
    h.setNow(T0 + 40 * min);
    h.setEntries([{ date: T0 + 39 * min, mgdl: 200, direction: "Flat" }]);
    await checkSubscription(h.deps, must(h.get()));
    expect(aps(must(h.sent.at(-1)))).toMatchObject({
      alert: { title: "Høj: 11,1 mmol/L · 1 min siden" },
    });
  });

  it("sends one no-new-readings alert when the newest reading is 20 minutes old, even when the site is down", async () => {
    const r = row({
      activityPushToken: null,
      activityStartedAt: null,
      language: "en",
      lastReadingAt: new Date(T0 - 21 * min),
    });
    const h = harness([r], { entries: new NightscoutError("Timeout", 0) });
    await expect(checkSubscription(h.deps, r)).resolves.toBe("read-failed");
    expect(h.sent).toHaveLength(1);
    expect(aps(must(h.sent[0]))).toMatchObject({ alert: { title: "No new readings for 21 min" } });
    expect(h.get()).toMatchObject({ lastAlertKind: "stale", failures: 1 });
    h.setNow(T0 + 5 * min);
    await checkSubscription(h.deps, must(h.get()));
    expect(h.sent).toHaveLength(1);
    expect(h.get()?.failures).toBe(2);
  });

  it("tries an alert again on the next pass after a 5xx", async () => {
    let status = 503;
    const r = row({ activityPushToken: null, activityStartedAt: null });
    const h = harness([r], { entries: [entry(2, 65)], respond: () => ({ status }) });
    await checkSubscription(h.deps, r);
    expect(h.get()?.lastAlertKind).toBeNull();
    status = 200;
    h.setNow(T0 + min);
    await checkSubscription(h.deps, must(h.get()));
    expect(h.sent).toHaveLength(2);
    expect(h.get()?.lastAlertKind).toBe("low");
  });
});

describe("checkSubscription: tokens Apple calls invalid", () => {
  it("clears an activity token Apple answers 410 for, and keeps the subscription", async () => {
    const r = row();
    const h = harness([r], {
      respond: (request) =>
        request.deviceToken === ACTIVITY
          ? { status: 410, reason: "Unregistered" }
          : { status: 200 },
    });
    await checkSubscription(h.deps, r);
    expect(h.get()).toMatchObject({ activityPushToken: null, pushToStartToken: START });
  });

  it("deletes the row and its Key Vault secret when no valid token is left", async () => {
    const r = row({ activityPushToken: null, activityStartedAt: null, pushToStartToken: null });
    const h = harness([r], {
      entries: [entry(2, 60)],
      respond: () => ({ status: 400, reason: "BadDeviceToken" }),
    });
    await expect(checkSubscription(h.deps, r)).resolves.toBe("removed");
    expect(h.get()).toBeUndefined();
    await expect(h.secrets.get(liveSecretName(r.id))).resolves.toBeUndefined();
    expect(h.lines.join("\n")).toContain('"code":"tokens-invalid"');
  });

  describe("a push-to-start token Apple rejects at the 8-hour restart", () => {
    const old = new Date(T0 - RESTART_AFTER_MS);
    const gone = { status: 410, reason: "Unregistered" };

    it("deletes the row and its secret when no activity token is left, even with a device token", async () => {
      const r = row({ activityStartedAt: old, activityPushToken: null });
      const h = harness([r], {
        respond: (request) => (request.deviceToken === START ? gone : { status: 200 }),
      });
      await expect(checkSubscription(h.deps, r)).resolves.toBe("removed");
      expect(h.get()).toBeUndefined();
      await expect(h.secrets.get(liveSecretName(r.id))).resolves.toBeUndefined();
      expect(h.lines.join("\n")).toContain('"code":"push-to-start-invalid"');
    });

    it("deletes it when the activity token is rejected too", async () => {
      const r = row({ activityStartedAt: old });
      const h = harness([r], {
        respond: (request) =>
          request.deviceToken === DEVICE
            ? { status: 200 }
            : { status: 400, reason: "BadDeviceToken" },
      });
      await expect(checkSubscription(h.deps, r)).resolves.toBe("removed");
      expect(h.sent.map((s) => s.request.deviceToken)).toEqual([ACTIVITY, START]);
      expect(h.get()).toBeUndefined();
      await expect(h.secrets.get(liveSecretName(r.id))).resolves.toBeUndefined();
    });

    it("keeps it while a valid activity token is left; that activity keeps working until it ends", async () => {
      const fresh = "d4".repeat(32);
      const r = row({ activityStartedAt: old });
      const h = harness([r], {
        respond: (request) => {
          if (request.deviceToken !== START) return { status: 200 };
          // The app registers a new activity while the restart is being sent.
          const current = must(h.store.rows.get(r.id));
          h.store.rows.set(r.id, { ...current, activityPushToken: fresh });
          return gone;
        },
      });
      await checkSubscription(h.deps, r);
      expect(h.get()).toMatchObject({
        pushToStartToken: null,
        activityPushToken: fresh,
        deviceToken: DEVICE,
      });
      await expect(h.secrets.get(liveSecretName(r.id))).resolves.toBeDefined();

      // Its updates still go out on the next reading.
      h.setNow(T0 + 5 * min);
      h.setEntries([entry(0, 125), entry(5, 120)]);
      await checkSubscription(h.deps, must(h.get()));
      expect(h.sent.at(-1)?.request.deviceToken).toBe(fresh);
      expect(h.get()).toBeDefined();
    });

    it("keeps a subscription whose device token alone Apple rejects, while push tokens are left", async () => {
      const r = row();
      const h = harness([r], {
        entries: [entry(2, 60)],
        respond: (request) => (request.deviceToken === DEVICE ? gone : { status: 200 }),
      });
      await checkSubscription(h.deps, r);
      expect(h.get()).toMatchObject({
        deviceToken: null,
        pushToStartToken: START,
        activityPushToken: ACTIVITY,
      });
    });
  });
});

describe("checkSubscription: what it does not trust", () => {
  it("ignores a reading dated in the future, so a clock error cannot stop the polling", async () => {
    const r = row({ deviceToken: null });
    const h = harness([r], { entries: [entry(-24 * 60, 120), entry(1, 118)] });
    await checkSubscription(h.deps, r);
    expect(h.get()?.lastReadingAt).toEqual(new Date(T0 - min));
    expect(aps(must(h.sent[0]))).toMatchObject({ "content-state": { mgdl: 118 } });
  });

  it("reads no site for a subscription without any token, and removes it after a day", async () => {
    const r = row({
      pushToStartToken: null,
      activityPushToken: null,
      deviceToken: null,
      lastSeenAt: new Date(T0 - 60 * min),
    });
    const h = harness([r]);
    let reads = 0;
    h.deps.readEntries = () => {
      reads += 1;
      return Promise.resolve([]);
    };
    await expect(checkSubscription(h.deps, r)).resolves.toBe("unchanged");
    expect(reads).toBe(0);
    expect(h.get()?.nextCheckAt).toEqual(new Date(T0 + 60 * min));
    h.setNow(T0 + 24 * 60 * min);
    await expect(checkSubscription(h.deps, must(h.get()))).resolves.toBe("removed");
    expect(h.get()).toBeUndefined();
    await expect(h.secrets.get(liveSecretName(r.id))).resolves.toBeUndefined();
  });
});

describe("runLivePoll", () => {
  it("checks only the due subscriptions and writes one summary line", async () => {
    const due = row({ id: "sub-due-1", deviceToken: null });
    const later = row({ id: "sub-later", nextCheckAt: new Date(T0 + 3 * min) });
    const h = harness([due, later]);
    const summary = await runLivePoll(h.deps);
    expect(summary.pushed).toBe(1);
    expect(h.sent.map((s) => s.request.deviceToken)).toEqual([ACTIVITY]);
    const last = JSON.parse(must(h.lines.at(-1))) as Record<string, unknown>;
    expect(last).toMatchObject({ msg: "live.poll", count: 1, code: "pushed:1" });
  });

  it("takes a check due within the next 20 seconds, so every minute does not slip to two", async () => {
    const r = row({ nextCheckAt: new Date(T0 + 15_000), deviceToken: null });
    const h = harness([r]);
    await runLivePoll(h.deps);
    expect(h.sent).toHaveLength(1);
  });

  it("deletes a subscription nothing reached and the app did not register for 30 days", async () => {
    const idle = row({
      id: "sub-idle-1",
      lastSeenAt: new Date(T0 - IDLE_AFTER_MS - 1),
      nextCheckAt: new Date(T0 + min),
    });
    const alive = row({
      id: "sub-alive",
      lastSeenAt: new Date(T0 - IDLE_AFTER_MS + min),
      nextCheckAt: new Date(T0 + min),
    });
    const h = harness([idle, alive]);
    await runLivePoll(h.deps);
    expect(h.get("sub-idle-1")).toBeUndefined();
    await expect(h.secrets.get(liveSecretName("sub-idle-1"))).resolves.toBeUndefined();
    expect(h.get("sub-alive")).toBeDefined();
    await expect(h.secrets.get(liveSecretName("sub-alive"))).resolves.toBeDefined();
  });

  it("keeps an idle subscription the app registered after the cleanup selected it", async () => {
    const idle = row({
      id: "sub-idle-2",
      lastSeenAt: new Date(T0 - IDLE_AFTER_MS - 1),
      nextCheckAt: new Date(T0 + min),
    });
    const h = harness([idle]);
    const select = h.store.idle.bind(h.store);
    h.store.idle = async (before, limit) => {
      const rows = await select(before, limit);
      // The app registers between the select and the delete.
      await h.store.update("sub-idle-2", { lastSeenAt: new Date(T0) });
      return rows;
    };
    await runLivePoll(h.deps);
    expect(h.get("sub-idle-2")).toBeDefined();
    await expect(h.secrets.get(liveSecretName("sub-idle-2"))).resolves.toBeDefined();
  });

  it("reads at most 16 sites at once and keeps going when one check throws", async () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({ id: `sub-many-${String(i).padStart(2, "0")}`, deviceToken: null }),
    );
    const h = harness(rows);
    let running = 0;
    let peak = 0;
    h.deps.readEntries = async (r: LiveRow) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      if (r.id === "sub-many-07") throw new Error("boom");
      return [entry(1, 120)];
    };
    const update = h.store.update.bind(h.store);
    h.store.update = (id, patch, expect) =>
      id === "sub-many-09" ? Promise.reject(new Error("db down")) : update(id, patch, expect);
    const summary = await runLivePoll(h.deps);
    expect(peak).toBeLessThanOrEqual(CHECK_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    expect(summary).toMatchObject({ pushed: 38, "read-failed": 1, error: 1 });
  });

  it("never logs a token, an address or a value", async () => {
    const r = row({ id: "sub-logs-1" });
    const h = harness([r], {
      entries: [entry(2, 65)],
      respond: (request) =>
        request.pushType === "alert" ? { status: 400, reason: "BadDeviceToken" } : { status: 200 },
    });
    await runLivePoll(h.deps);
    const text = h.lines.join("\n");
    expect(h.lines.length).toBeGreaterThan(1);
    for (const secret of [
      ACTIVITY,
      START,
      DEVICE,
      "ns.example.org",
      "fixture-token",
      "3,6",
      "65",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('"subscriptionId":"sub-logs-1"');
  });
});

describe("Key Vault cleanup is eventually consistent", () => {
  const idleRow = (id: string) =>
    row({ id, lastSeenAt: new Date(T0 - IDLE_AFTER_MS - 1), nextCheckAt: new Date(T0 + min) });

  it("tries a failed secret delete once more, and the idle row still goes", async () => {
    const h = harness([idleRow("sub-retry-1")]);
    const calls = failDeletes(h, 1);
    await runLivePoll(h.deps);
    expect(calls.asked).toBe(2);
    expect(h.get("sub-retry-1")).toBeUndefined();
    await expect(h.secrets.get(liveSecretName("sub-retry-1"))).resolves.toBeUndefined();
    expect(messages(h.lines)).toContain("live.removed");
  });

  it("leaves a secret both tries failed for, and the hourly sweep removes it", async () => {
    const h = harness([idleRow("sub-orphan-1")]);
    const calls = failDeletes(h, 2);
    h.setNow(T0 + ORPHAN_GRACE_MS - 30 * min);
    await runLivePoll(h.deps);
    expect(calls.asked).toBe(2);
    expect(h.get("sub-orphan-1")).toBeUndefined();
    await expect(h.secrets.get(liveSecretName("sub-orphan-1"))).resolves.toBeDefined();
    expect(messages(h.lines)).toContain("live.secret-delete-failed");

    h.setNow(T0 + ORPHAN_GRACE_MS);
    await runLivePoll(h.deps);
    await expect(h.secrets.get(liveSecretName("sub-orphan-1"))).resolves.toBeUndefined();
    const removed = h.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === "live.secret-orphan-removed");
    expect(removed).toMatchObject({ subscriptionId: "sub-orphan-1", code: "no-row" });
  });

  it("does the same for a tokenless subscription removed after a day", async () => {
    const r = row({
      id: "sub-orphan-2",
      pushToStartToken: null,
      activityPushToken: null,
      deviceToken: null,
      lastSeenAt: new Date(T0 - 24 * 60 * min),
    });
    const h = harness([r]);
    failDeletes(h, 2);
    h.setNow(T0 + 30 * min);
    await expect(checkSubscription(h.deps, r)).resolves.toBe("removed");
    await expect(h.secrets.get(liveSecretName("sub-orphan-2"))).resolves.toBeDefined();
    h.setNow(T0 + 2 * ORPHAN_GRACE_MS);
    await runLivePoll(h.deps);
    await expect(h.secrets.get(liveSecretName("sub-orphan-2"))).resolves.toBeUndefined();
  });

  it("keeps a secret whose subscription still has a row", async () => {
    const h = harness([
      row({ id: "sub-kept-1", nextCheckAt: new Date(T0 + 10 * ORPHAN_GRACE_MS) }),
    ]);
    h.setNow(T0 + 5 * ORPHAN_GRACE_MS);
    await runLivePoll(h.deps);
    await expect(h.secrets.get(liveSecretName("sub-kept-1"))).resolves.toBeDefined();
    expect(messages(h.lines)).not.toContain("live.secret-orphan-removed");
  });

  it("keeps a fresh secret without a row: a registration may be writing its row", async () => {
    const h = harness([]);
    h.setNow(T0 + 30 * min);
    await h.secrets.set(liveSecretName("sub-new-1"), "fixture-credential");
    await h.secrets.set("glucose-s1", "not the relay's");
    h.setNow(T0 + ORPHAN_GRACE_MS);
    await runLivePoll(h.deps);
    await expect(h.secrets.get(liveSecretName("sub-new-1"))).resolves.toBeDefined();
    h.setNow(T0 + 2 * ORPHAN_GRACE_MS);
    await runLivePoll(h.deps);
    await expect(h.secrets.get(liveSecretName("sub-new-1"))).resolves.toBeUndefined();
    await expect(h.secrets.get("glucose-s1")).resolves.toBeDefined();
  });

  it("sweeps at most once an hour, in the run that starts in minute 0", async () => {
    const h = harness([]);
    const list = h.secrets.list.bind(h.secrets);
    let listed = 0;
    h.secrets.list = (prefix) => {
      listed += 1;
      expect(prefix).toBe("live-");
      return list(prefix);
    };
    for (let minute = 0; minute < 120; minute += 1) {
      h.setNow(T0 + minute * min + 30_000);
      await runLivePoll(h.deps);
    }
    expect(listed).toBe(2);
  });

  it("logs a failed listing and still checks the due subscriptions", async () => {
    const h = harness([row({ deviceToken: null })]);
    h.secrets.list = () => Promise.reject(new Error("vault unavailable"));
    const summary = await runLivePoll(h.deps);
    expect(summary.pushed).toBe(1);
    expect(messages(h.lines)).toContain("live.secret-sweep-failed");
  });
});

describe("createEntryReader", () => {
  it("answers the demo curve without reading a secret or a site", async () => {
    const reader = createEntryReader({
      secrets: { get: () => Promise.reject(new Error("no secret for the demo")) },
      fetch: () => Promise.reject(new Error("no fetch for the demo")),
    });
    const entries = await reader(row({ isDemo: true, tokenSecretRef: null }), T0);
    expect(entries).toHaveLength(3);
  });

  it("reads three entries from the stored site with the token in the auth header, reading the secret once", async () => {
    const secrets = new MemorySecrets({
      [liveSecretName("sub-0001")]: serializeNightscoutCredential({
        url: SITE,
        token: "fixture-token",
      }),
    });
    let reads = 0;
    const get = secrets.get.bind(secrets);
    const calls: {
      url: string;
      headers: Record<string, string> | undefined;
      method?: string | undefined;
    }[] = [];
    const fetch: FetchLike = (input, init) => {
      calls.push({ url: String(input), headers: init?.headers, method: init?.method });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              { sgv: 120, date: T0 - min, direction: "Flat", type: "sgv" },
              { sgv: 115, date: T0 - 6 * min, direction: "Flat", type: "sgv" },
            ]),
          ),
      });
    };
    const reader = createEntryReader({
      secrets: {
        get: (ref) => {
          reads += 1;
          return get(ref);
        },
      },
      fetch,
    });
    const r = row({ tokenSecretRef: liveSecretName("sub-0001") });
    await expect(reader(r, T0)).resolves.toEqual([
      { date: T0 - min, mgdl: 120, direction: "Flat" },
      { date: T0 - 6 * min, mgdl: 115, direction: "Flat" },
    ]);
    await reader(r, T0);
    expect(reads).toBe(1);
    expect(calls[0]?.method).toBe("GET");
    const url = new URL(calls[0]?.url ?? "");
    expect(url.origin).toBe(new URL(SITE).origin);
    expect(url.pathname.endsWith("/sgv.json")).toBe(true);
    expect(url.search).toBe("?count=3");
    expect(calls[0]?.url).not.toContain("fixture-token");
    expect(Object.values(calls[0]?.headers ?? {})).toContain("fixture-token");
  });

  it("fails with a code when the secret is gone", async () => {
    const reader = createEntryReader({ secrets: new MemorySecrets() });
    await expect(reader(row(), T0)).rejects.toMatchObject({ code: "NoCredential" });
  });
});

describe("the APNs plumbing", () => {
  it("maps Apple's answers to what the relay does", () => {
    expect(verdictOf({ status: 200 })).toBe("accepted");
    expect(verdictOf({ status: 410, reason: "Unregistered" })).toBe("invalid-token");
    expect(verdictOf({ status: 400, reason: "BadDeviceToken" })).toBe("invalid-token");
    expect(verdictOf({ status: 503 })).toBe("retry");
    expect(verdictOf({ status: 429 })).toBe("retry");
    expect(verdictOf(undefined)).toBe("retry");
    expect(verdictOf({ status: 403, reason: "InvalidProviderToken" })).toBe("refused");
  });

  it("reads the key from apns-key-p8 and asks again after it was missing", async () => {
    let reads = 0;
    const send = createApnsSenders({
      get: (ref) => {
        reads += 1;
        expect(ref).toBe("apns-key-p8");
        return Promise.resolve(undefined);
      },
    });
    const request: ApnsRequest = {
      deviceToken: DEVICE,
      pushType: "alert",
      priority: 10,
      payload: {},
    };
    await expect(send("sandbox", request)).rejects.toThrow("apns-key-missing");
    await expect(send("sandbox", request)).rejects.toThrow("apns-key-missing");
    expect(reads).toBe(2);
  });

  it("mapLimit keeps the order of its results", async () => {
    await expect(mapLimit([3, 1, 2], 2, (n) => Promise.resolve(n * 2))).resolves.toEqual([6, 2, 4]);
  });
});
