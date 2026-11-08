import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVITY_ATTRIBUTES_TYPE,
  DEFAULT_ATTRIBUTES,
  contentState,
  endPayload,
  startPayload,
  updatePayload,
} from "./payloads";

// The contract with the app: FollowCore's tests decode and encode the same file.
const fixture = path.resolve(
  import.meta.dirname,
  "../../../ios/Packages/FollowCore/Tests/FollowCoreTests/Fixtures/content-state.json",
);

const current = { date: 1793016000000, mgdl: 151, direction: "FortyFiveUp" };
const previous = { date: 1793015700000, mgdl: 145, direction: "Flat" };
const now = 1793016030;

describe("contentState", () => {
  it("matches the fixture the app decodes, key for key", () => {
    const expected: unknown = JSON.parse(readFileSync(fixture, "utf8"));
    expect(contentState(current, previous)).toEqual(expected);
  });

  it("has no change without a previous reading, or one more than 12 minutes back or ahead", () => {
    expect(contentState(current, undefined).delta).toBeNull();
    expect(
      contentState(current, { ...previous, date: current.date - 13 * 60_000 }).delta,
    ).toBeNull();
    expect(contentState(previous, current).delta).toBeNull();
    expect(contentState(current, { ...previous, mgdl: 160 }).delta).toBe(-9);
  });
});

describe("payloads", () => {
  const state = contentState(current, previous);

  it("updates with a stale date 15 minutes after the reading", () => {
    expect(updatePayload(state, now)).toEqual({
      aps: {
        timestamp: now,
        event: "update",
        "content-state": state,
        "stale-date": 1793016000 + 900,
      },
    });
  });

  it("ends and dismisses at once", () => {
    expect(endPayload(state, now)).toEqual({
      aps: { timestamp: now, event: "end", "content-state": state, "dismissal-date": now },
    });
  });

  it("starts by naming the app's attributes type, with an alert that carries no value", () => {
    const payload = startPayload(state, DEFAULT_ATTRIBUTES, now) as {
      aps: Record<string, unknown> & { alert: { title: string; body: string } };
    };
    expect(payload.aps["attributes-type"]).toBe(ACTIVITY_ATTRIBUTES_TYPE);
    expect(payload.aps.attributes).toEqual({ unit: "mmolL" });
    expect(payload.aps.event).toBe("start");
    expect(payload.aps["input-push-token"]).toBe(1);
    expect(JSON.stringify(payload.aps.alert)).not.toMatch(/\d/);
  });
});
