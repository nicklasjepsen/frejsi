// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FakeAuthDb, recordingSink } from "@/lib/auth/test-support";

import { saveConnectedSource, toSpaceSettings, updateSpaceSettings } from "./space-settings";

const T0 = new Date("2026-10-15T08:00:00.000Z");

function setup() {
  const fake = new FakeAuthDb(() => T0);
  const { sink, events } = recordingSink();
  fake.rows("space").push({
    id: "s1",
    name: "Example space",
    timezone: "Europe/Copenhagen",
    glucoseUnit: "mmol",
    targetLow: 4,
    targetHigh: 10,
    glucoseSource: null,
    sourceStatus: "not-configured",
    sourceFailures: 2,
    lastReadingAt: null,
    lastSeq: 0,
  });
  return { fake, events, deps: { db: fake.db, sink, now: () => T0 } };
}

describe("toSpaceSettings", () => {
  it("maps the row to the shared contract: targets as numbers, the source type from the JSON, the time as ISO", () => {
    expect(
      toSpaceSettings({
        name: "Example space",
        timezone: "Europe/Copenhagen",
        glucoseUnit: "mgdl",
        targetLow: { toString: () => "3.9" },
        targetHigh: 10,
        glucoseSource: JSON.stringify({ type: "dexcom-share", region: "eu", secretRef: "glucose-s1" }),
        sourceStatus: "connected",
        lastReadingAt: new Date("2026-10-15T13:13:00.000Z"),
      }),
    ).toEqual({
      aiEnabled: false,
      name: "Example space",
      timezone: "Europe/Copenhagen",
      glucoseUnit: "mgdl",
      targetLow: 3.9,
      targetHigh: 10,
      sourceType: "dexcom-share",
      sourceStatus: "connected",
      lastReadingAt: "2026-10-15T13:13:00.000Z",
    });
  });

  it("never carries the secretRef or the raw source JSON", () => {
    const settings = toSpaceSettings({
      name: "x",
      timezone: "Europe/Copenhagen",
      glucoseUnit: "mmol",
      targetLow: 4,
      targetHigh: 10,
      glucoseSource: JSON.stringify({ type: "dexcom-share", region: "us", secretRef: "glucose-s1" }),
      sourceStatus: "connected",
      lastReadingAt: null,
    });
    expect(JSON.stringify(settings)).not.toContain("glucose-s1");
    expect(JSON.stringify(settings)).not.toContain("region");
    expect(settings.lastReadingAt).toBeNull();
  });

  it("reads an unparseable or missing source as none", () => {
    const base = {
      name: "x",
      timezone: "Europe/Copenhagen",
      glucoseUnit: "mmol",
      targetLow: 4,
      targetHigh: 10,
      sourceStatus: "not-configured",
      lastReadingAt: null,
    };
    expect(toSpaceSettings({ ...base, glucoseSource: null }).sourceType).toBeNull();
    expect(toSpaceSettings({ ...base, glucoseSource: "{nope" }).sourceType).toBeNull();
  });
});

describe("updateSpaceSettings", () => {
  it("writes the unit and emits space.updated naming the field", async () => {
    const { fake, events, deps } = setup();
    const result = await updateSpaceSettings("s1", { glucoseUnit: "mgdl" }, deps);
    expect(result.glucoseUnit).toBe("mgdl");
    expect(result.targetLow).toBe(4);
    expect(fake.rows("space")[0]).toMatchObject({ glucoseUnit: "mgdl", targetLow: 4, targetHigh: 10 });
    expect(events).toEqual([
      { spaceId: "s1", type: "space.updated", payload: { fields: ["glucoseUnit"] } },
    ]);
  });

  it("writes the target range in mmol and refuses a range that crosses the stored other end", async () => {
    const { fake, events, deps } = setup();
    await updateSpaceSettings("s1", { targetLow: 3.9, targetHigh: 9 }, deps);
    expect(fake.rows("space")[0]).toMatchObject({ targetLow: 3.9, targetHigh: 9 });
    expect(events[0]).toMatchObject({ payload: { fields: ["targetLow", "targetHigh"] } });

    await expect(updateSpaceSettings("s1", { targetLow: 9.5 }, deps)).rejects.toMatchObject({
      status: 400,
      code: "validation",
    });
    await expect(updateSpaceSettings("s1", { targetHigh: 3 }, deps)).rejects.toMatchObject({
      status: 400,
      code: "validation",
    });
    expect(fake.rows("space")[0]).toMatchObject({ targetLow: 3.9, targetHigh: 9 });
    expect(events).toHaveLength(1);
  });

  it("checks the range against the stored row and writes it in one serializable transaction, so two partial saves cannot leave low above high", async () => {
    const { fake, deps } = setup();
    fake.transactions.length = 0;
    await updateSpaceSettings("s1", { targetLow: 5 }, deps);
    expect(fake.transactions).toEqual([{ isolationLevel: "Serializable" }]);
    expect(fake.operations.every((o) => o.inTransaction)).toBe(true);
  });

  it("is 404 for an unknown space", async () => {
    const { deps } = setup();
    await expect(updateSpaceSettings("nope", { glucoseUnit: "mmol" }, deps)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("saveConnectedSource", () => {
  it("stores only { type, region, secretRef }, sets connected, resets the failure count and emits source.status then space.updated", async () => {
    const { fake, events, deps } = setup();
    const result = await saveConnectedSource(
      "s1",
      { type: "dexcom-share", region: "eu", secretRef: "glucose-s1" },
      deps,
    );
    expect(result).toMatchObject({ sourceType: "dexcom-share", sourceStatus: "connected" });
    const row = fake.rows("space")[0];
    expect(row).toMatchObject({ sourceStatus: "connected", sourceFailures: 0 });
    expect(JSON.parse(row?.glucoseSource as string)).toEqual({
      type: "dexcom-share",
      region: "eu",
      secretRef: "glucose-s1",
    });
    expect(events).toEqual([
      {
        spaceId: "s1",
        type: "source.status",
        payload: { status: "connected", since: "2026-10-15T08:00:00.000Z" },
      },
      { spaceId: "s1", type: "space.updated", payload: { fields: ["glucoseSource", "sourceStatus"] } },
    ]);
  });
});
