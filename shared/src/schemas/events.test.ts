import { describe, expect, it } from "vitest";

import { EventEnvelope, EventPayloads, EventType, type EventPayload } from "./events";

const ts = "2026-10-15T08:00:00.000Z";

/** One valid payload per event type. */
export const samplePayloads: { [T in EventType]: EventPayload<T> } = {
  reading: { ts, mmol: 6.2, trend: "flat" },
  "source.status": { status: "disconnected", since: ts },
  "space.updated": { fields: ["name", "targetHigh"] },
  "member.joined": { userId: "u1", role: "carer" },
  "member.updated": { userId: "u1", role: "owner" },
  "member.removed": { userId: "u1" },
  "invite.created": { tokenHash: "abc", role: "viewer", name: "Example Person" },
  "invite.revoked": { tokenHash: "abc", role: "viewer", name: "Example Person", forUserId: "u2" },
  "device.added": { userId: "u1", passkeyId: "p1" },
  "device.removed": { userId: "u1", passkeyId: "p1" },
  "food.created": { foodId: "f1", origin: "manual" },
  "food.updated": { foodId: "f1" },
  "food.verified": { foodId: "f1", verifiedBy: "u1" },
  "food.deleted": { foodId: "f1" },
  "meal.created": { mealId: "m1", ts, totalCarbs: 18 },
  "meal.updated": { mealId: "m1" },
  "meal.deleted": { mealId: "m1" },
  "readings.imported": { count: 288, from: ts, to: ts },
  "insight.created": { insightId: "i1", kind: "meal", subjectKey: "m1" },
  "insight.updated": { insightId: "i1" },
  "estimate.asked": { foodId: "f1", byUserId: "u1" },
  "push.subscribed": { userId: "u1", spaceId: "s1" },
  "push.unsubscribed": { userId: "u1", spaceId: "s1" },
};

describe("EventEnvelope", () => {
  it("lists every event type", () => {
    expect(EventType.options).toEqual([
      "reading",
      "source.status",
      "space.updated",
      "member.joined",
      "member.updated",
      "member.removed",
      "invite.created",
      "invite.revoked",
      "device.added",
      "device.removed",
      "food.created",
      "food.updated",
      "food.verified",
      "food.deleted",
      "meal.created",
      "meal.updated",
      "meal.deleted",
      "readings.imported",
      "insight.created",
      "insight.updated",
      "estimate.asked",
      "push.subscribed",
      "push.unsubscribed",
    ]);
    expect(Object.keys(EventPayloads).sort()).toEqual([...EventType.options].sort());
  });

  it.each(EventType.options)("accepts a %s envelope with its own payload", (type) => {
    const envelope = { spaceId: "s1", seq: 1, ts, type, payload: samplePayloads[type] };
    expect(EventEnvelope.parse(envelope)).toEqual(envelope);
  });

  it.each(EventType.options)("rejects a %s envelope carrying another type's payload", (type) => {
    // The payload least like this type's own: a reading for everything else, a member for reading.
    const foreign = type === "reading" ? samplePayloads["device.added"] : samplePayloads.reading;
    const envelope = { spaceId: "s1", seq: 1, ts, type, payload: foreign };
    expect(EventEnvelope.safeParse(envelope).success).toBe(false);
  });

  it("narrows payload by type after parsing", () => {
    const parsed = EventEnvelope.parse({
      spaceId: "s1",
      seq: 7,
      ts,
      type: "reading",
      payload: samplePayloads.reading,
    });
    if (parsed.type === "reading") {
      expect(parsed.payload.mmol).toBe(6.2);
    } else {
      throw new Error("expected a reading");
    }
  });

  it("rejects an unknown type and a non-positive seq", () => {
    expect(
      EventEnvelope.safeParse({ spaceId: "s1", seq: 1, ts, type: "unknown.event", payload: {} })
        .success,
    ).toBe(false);
    expect(
      EventEnvelope.safeParse({
        spaceId: "s1",
        seq: 0,
        ts,
        type: "reading",
        payload: samplePayloads.reading,
      }).success,
    ).toBe(false);
  });
});

// These notifications travel to every member, including viewers. No generated text or endpoint.
it("keeps AI event payloads viewer-safe and narrows each envelope", () => {
  for (const type of [
    "insight.created",
    "insight.updated",
    "estimate.asked",
    "push.subscribed",
    "push.unsubscribed",
  ] as const) {
    const parsed = EventEnvelope.parse({
      spaceId: "s1",
      seq: 1,
      ts,
      type,
      payload: samplePayloads[type],
    });
    if (parsed.type === "insight.created") expect(parsed.payload.subjectKey).toBe("m1");
    if (parsed.type === "insight.updated") expect(parsed.payload.insightId).toBe("i1");
    if (parsed.type === "estimate.asked") expect(parsed.payload.byUserId).toBe("u1");
    if (parsed.type === "push.subscribed" || parsed.type === "push.unsubscribed")
      expect(parsed.payload.userId).toBe("u1");
    for (const key of [
      "mmol",
      "mgdl",
      "trend",
      "reading",
      "readings",
      "glucose",
      "targetLow",
      "targetHigh",
      "inRange",
      "peak",
      "stats",
      "numbers",
      "bolusTs",
      "text",
      "endpoint",
    ]) {
      expect(
        EventPayloads[type].safeParse({ ...samplePayloads[type], [key]: "private" }).success,
      ).toBe(false);
    }
  }
});
