import { describe, expect, it } from "vitest";

import {
  EventEnvelope,
  EventPayloads,
  EventType,
  GLUCOSE_EVENT_TYPES,
  isGlucoseEvent,
  type EventPayload,
} from "./events";

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
  "food.contributed": { foodId: "f1", source: "off" },
  "symptom.created": { symptomId: "sy1", ts, kind: "tired", byUserId: "u1" },
  "symptom.updated": { symptomId: "sy1" },
  "symptom.deleted": { symptomId: "sy1" },
  "pump.imported": { count: 12, from: ts, to: ts },
  "pump.meals": { updated: ["m1"], created: ["m2"], removed: [] },
  "pump.status": { status: "disconnected", since: ts },
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
      "food.contributed",
      "symptom.created",
      "symptom.updated",
      "symptom.deleted",
      "pump.imported",
      "pump.meals",
      "pump.status",
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

describe("food.contributed", () => {
  it("narrows to { foodId, source } and carries no glucose key", () => {
    const parsed = EventEnvelope.parse({
      spaceId: "s1",
      seq: 3,
      ts,
      type: "food.contributed",
      payload: { foodId: "f1", source: "off" },
    });
    if (parsed.type !== "food.contributed") throw new Error("expected food.contributed");
    expect(Object.keys(parsed.payload).sort()).toEqual(["foodId", "source"]);
    expect(
      EventPayloads["food.contributed"].safeParse({ foodId: "f1", source: "off", mmol: 6 }).success,
    ).toBe(false);
    expect(EventPayloads["food.contributed"].safeParse({ foodId: "f1" }).success).toBe(false);
  });
});

describe("symptom.* (v0.6.0 plan §4)", () => {
  it("narrows each envelope, carries ids, a kind and a time only, and is not a glucose event", () => {
    const created = EventEnvelope.parse({
      spaceId: "s1",
      seq: 4,
      ts,
      type: "symptom.created",
      payload: samplePayloads["symptom.created"],
    });
    if (created.type !== "symptom.created") throw new Error("expected symptom.created");
    expect(Object.keys(created.payload).sort()).toEqual(["byUserId", "kind", "symptomId", "ts"]);
    for (const type of ["symptom.updated", "symptom.deleted"] as const) {
      const parsed = EventEnvelope.parse({
        spaceId: "s1",
        seq: 5,
        ts,
        type,
        payload: { symptomId: "sy1" },
      });
      if (parsed.type !== type) throw new Error(`expected ${type}`);
      expect(Object.keys(parsed.payload)).toEqual(["symptomId"]);
    }
    for (const key of ["note", "severity", "mmol", "trend", "readings", "text"]) {
      expect(
        EventPayloads["symptom.created"].safeParse({
          ...samplePayloads["symptom.created"],
          [key]: "private",
        }).success,
      ).toBe(false);
    }
    expect(
      EventPayloads["symptom.created"].safeParse({
        ...samplePayloads["symptom.created"],
        kind: "sad",
      }).success,
    ).toBe(false);
    // Viewers receive them: a symptom carries no glucose.
    expect(GLUCOSE_EVENT_TYPES).toEqual([
      "reading",
      "readings.imported",
      "pump.imported",
      "pump.meals",
      "pump.status",
    ]);
    for (const type of ["symptom.created", "symptom.updated", "symptom.deleted"] as const)
      expect(isGlucoseEvent(type)).toBe(false);
  });
});

describe("pump.* (v0.7.0 plan §4)", () => {
  it("comes after symptom.deleted, in the order the plan appends them", () => {
    const options = EventType.options;
    const at = (type: EventType) => options.indexOf(type);
    expect(at("pump.imported")).toBe(at("symptom.deleted") + 1);
    expect(at("pump.meals")).toBe(at("pump.imported") + 1);
    expect(at("pump.status")).toBe(at("pump.meals") + 1);
    expect(options.length).toBe(at("pump.status") + 1);
  });

  it("is a glucose-group event, every one of them, so a viewer's group never carries them", () => {
    for (const type of ["pump.imported", "pump.meals", "pump.status"] as const) {
      expect(isGlucoseEvent(type), type).toBe(true);
      expect(GLUCOSE_EVENT_TYPES).toContain(type);
    }
    expect(isGlucoseEvent("meal.updated")).toBe(false);
  });

  it("carries counts and a range, meal ids, or a status: never units, carbs or a time per bolus", () => {
    const imported = EventEnvelope.parse({
      spaceId: "s1",
      seq: 8,
      ts,
      type: "pump.imported",
      payload: samplePayloads["pump.imported"],
    });
    if (imported.type !== "pump.imported") throw new Error("expected pump.imported");
    expect(Object.keys(imported.payload).sort()).toEqual(["count", "from", "to"]);
    const meals = EventEnvelope.parse({
      spaceId: "s1",
      seq: 9,
      ts,
      type: "pump.meals",
      payload: samplePayloads["pump.meals"],
    });
    if (meals.type !== "pump.meals") throw new Error("expected pump.meals");
    expect(meals.payload).toEqual({ updated: ["m1"], created: ["m2"], removed: [] });
    const status = EventEnvelope.parse({
      spaceId: "s1",
      seq: 10,
      ts,
      type: "pump.status",
      payload: samplePayloads["pump.status"],
    });
    if (status.type !== "pump.status") throw new Error("expected pump.status");
    expect(status.payload.status).toBe("disconnected");
    for (const type of ["pump.imported", "pump.meals", "pump.status"] as const) {
      for (const key of ["units", "bolusUnits", "carbs", "boluses", "mmol", "kind", "sourceId"]) {
        expect(
          EventPayloads[type].safeParse({ ...samplePayloads[type], [key]: 1 }).success,
          `${type}.${key}`,
        ).toBe(false);
      }
    }
    expect(EventPayloads["pump.meals"].safeParse({ updated: [], created: [] }).success).toBe(false);
    expect(EventPayloads["pump.imported"].safeParse({ count: -1, from: ts, to: ts }).success).toBe(
      false,
    );
    expect(EventPayloads["pump.status"].safeParse({ status: "online", since: ts }).success).toBe(
      false,
    );
  });
});
