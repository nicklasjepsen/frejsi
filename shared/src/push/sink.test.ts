import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../schemas/events";
import { EventType } from "../schemas/events";
import da from "./messages/da.json";
import en from "./messages/en.json";
import {
  WebPushSink,
  type NotificationPayload,
  type PushRepository,
  type PushRecipient,
} from "./sink";

const envelope = {
  spaceId: "s1",
  seq: 1,
  ts: "2026-10-15T12:00:00.000Z",
  type: "estimate.asked",
  payload: { foodId: "f1", byUserId: "child" },
} as const;
const recipient = (id: string, locale: "da" | "en" = "da"): PushRecipient => ({
  id,
  endpoint: `https://push.example/${id}`,
  keys: { p256dh: "fictional", auth: "fictional" },
  locale,
});
function setup() {
  const removed: string[] = [],
    failed: string[] = [],
    sent: NotificationPayload[] = [],
    logs: unknown[] = [];
  const repo: PushRepository = {
    asked: () => Promise.resolve({ child: "Example Child", dishName: "Example dish", carbs: 30 }),
    symptomLogger: () =>
      Promise.resolve({
        child: "Example Child",
        simpleMode: true,
        timezone: "Europe/Copenhagen",
        symptomKinds: [{ id: "custom:itchy", label: { da: "Kløe", en: "Itchy" } }],
      }),
    recipients: (_spaceId, excluded) =>
      Promise.resolve([recipient("r1"), recipient("r2", "en")].filter((r) => r.id !== excluded)),
    remove: (id) => {
      removed.push(id);
      return Promise.resolve();
    },
    failed: (id) => {
      failed.push(id);
      return Promise.resolve();
    },
  };
  return {
    repo,
    removed,
    failed,
    sent,
    logs,
    sink: (
      send = (_r: PushRecipient, payload: NotificationPayload) => {
        sent.push(payload);
        return Promise.resolve();
      },
    ) => new WebPushSink(repo, send, (fields) => logs.push(fields)),
  };
}
describe("WebPushSink", () => {
  it("delivers minimal translated notifications and a recipient-local link", async () => {
    const s = setup();
    await s.sink().publish("space-s1", envelope);
    expect(s.sent).toEqual([
      {
        title: "Example Child spørger om et billede",
        body: "Example dish · ca. 30 g · tryk for at tjekke",
        data: { url: "/da/library/f1" },
      },
      {
        title: "Example Child is asking about a photo",
        body: "Example dish · approx. 30 g · tap to check",
        data: { url: "/en/library/f1" },
      },
    ]);
    expect(Object.keys(s.sent.at(0) ?? { data: {} }).sort()).toEqual(["body", "data", "title"]);
    expect(Object.keys(s.sent.at(0)?.data ?? {})).toEqual(["url"]);
    expect(s.logs).toEqual([{ count: 2, code: "push-sent" }]);
    expect(JSON.stringify(s.logs)).not.toMatch(/Example|endpoint|push.example/);
  });
  it("ignores every other event type without even reading subscriptions", async () => {
    const s = setup();
    s.repo.asked = () => {
      throw new Error("unexpected read");
    };
    s.repo.symptomLogger = () => {
      throw new Error("unexpected read");
    };
    for (const type of EventType.options.filter(
      (t) => t !== "estimate.asked" && t !== "symptom.created",
    ))
      await s.sink().publish("space-s1", { ...envelope, type } as EventEnvelope);
    expect(s.sent).toEqual([]);
  });
  it("removes expired endpoints, counts other failures, and continues delivery", async () => {
    for (const statusCode of [404, 410, 500]) {
      const s = setup();
      await s
        .sink((r, p) => {
          if (r.id === "r1")
            return Promise.reject(
              Object.assign(new Error("Fictional push failure"), { statusCode }),
            );
          s.sent.push(p);
          return Promise.resolve();
        })
        .publish("space-s1", envelope);
      expect(s.removed).toEqual(statusCode === 500 ? [] : ["r1"]);
      expect(s.failed).toEqual(statusCode === 500 ? ["r1"] : []);
      expect(s.sent).toHaveLength(1);
      expect(JSON.stringify(s.logs)).not.toMatch(/push.example|Example/);
    }
  });
});

it.each([404, 500])(
  "continues delivery when %s failure bookkeeping also fails",
  async (statusCode) => {
    const s = setup();
    s.repo.remove = () => Promise.reject(new Error("Fictional database failure"));
    s.repo.failed = () => Promise.reject(new Error("Fictional database failure"));
    const sink = s.sink((recipient, payload) => {
      if (recipient.id === "r1")
        return Promise.reject(Object.assign(new Error("Fictional push failure"), { statusCode }));
      s.sent.push(payload);
      return Promise.resolve();
    });
    await expect(sink.publish("space-s1", envelope)).resolves.toBeUndefined();
    expect(s.sent).toHaveLength(1);
    expect(s.logs).toContainEqual({ count: 1, code: "push-bookkeeping-failed" });
  },
);

const symptom = {
  spaceId: "s1",
  seq: 2,
  ts: "2026-10-15T12:00:00.000Z",
  type: "symptom.created",
  payload: {
    symptomId: "y1",
    ts: "2026-10-15T12:00:00.000Z",
    kind: "stomach-ache",
    byUserId: "child",
  },
} as const;
describe("WebPushSink on symptom.created (plan §5, decision 8)", () => {
  it("tells every other owner or carer the child's name, the kind and the local time, linking to the day", async () => {
    const s = setup();
    await s.sink().publish("space-s1", symptom);
    expect(s.sent).toEqual([
      {
        title: "Example Child: Ondt i maven",
        body: "Logget kl. 14:00 · tryk for at se dagen",
        data: { url: "/da/history?date=2026-10-15" },
      },
      {
        title: "Example Child: Stomach ache",
        body: "Logged at 14:00 · tap to see the day",
        data: { url: "/en/history?date=2026-10-15" },
      },
    ]);
    expect(s.logs).toEqual([{ count: 2, code: "push-sent" }]);
    expect(JSON.stringify(s.logs)).not.toMatch(/Example|stomach|endpoint/);
  });
  it("names a custom kind by the space's own label", async () => {
    const s = setup();
    await s
      .sink()
      .publish("space-s1", { ...symptom, payload: { ...symptom.payload, kind: "custom:itchy" } });
    expect(s.sent.map((p) => p.title)).toEqual(["Example Child: Kløe", "Example Child: Itchy"]);
  });
  it("sends nothing for a normal-mode logger or a logger it cannot place, without reading recipients", async () => {
    for (const logger of [
      null,
      { child: "Example Adult", simpleMode: false, timezone: "Europe/Copenhagen", symptomKinds: [] },
    ]) {
      const s = setup();
      s.repo.symptomLogger = () => Promise.resolve(logger);
      s.repo.recipients = () => {
        throw new Error("unexpected read");
      };
      await s.sink().publish("space-s1", symptom);
      expect(s.sent).toEqual([]);
      expect(s.logs).toEqual([]);
    }
  });
  it("keeps the estimate copy and the symptom copy apart in both locales", () => {
    for (const messages of [da, en]) {
      expect(Object.keys(messages).sort()).toEqual(["estimate", "symptom"]);
      expect(Object.keys(messages.estimate).sort()).toEqual(["body", "title"]);
      expect(Object.keys(messages.symptom).sort()).toEqual(["body", "title"]);
      expect(messages.symptom.title).toContain("{kind}");
      expect(messages.symptom.body).toContain("{time}");
    }
  });
});
