// @vitest-environment node
import { PumpBolusView, PumpHistoryView } from "@frejsi/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { loadPumpHistory } from "./history";
import { FakePumpDb } from "./test-support";

const FROM = new Date("2026-10-14T22:00:00.000Z");
const TO = new Date("2026-10-15T22:00:00.000Z");

let fake: FakePumpDb;

beforeEach(() => {
  fake = new FakePumpDb();
  fake.addSpace({
    id: "s1",
    pumpStatus: "connected",
    lastPumpAt: new Date("2026-10-15T11:58:00.000Z"),
    pumpSource: '{"type":"nightscout","secretRef":"pump-s1/v1","connectedBy":"owner-1"}',
  });
  fake.addSpace({ id: "s2", pumpStatus: "not-configured", lastPumpAt: null });
  // Out of order on purpose: the read sorts.
  fake.addBolus("s1", {
    id: "b3",
    ts: "2026-10-15T11:58:00.000Z",
    units: "2.4",
    kind: "standard",
    carbs: 45,
  });
  fake.addBolus("s1", {
    id: "b1",
    ts: "2026-10-15T03:10:00.000Z",
    units: "0.6",
    kind: "automatic",
  });
  fake.addBolus("s1", {
    id: "b2",
    ts: "2026-10-15T07:30:00.000Z",
    units: "1.25",
    kind: "extended",
  });
  fake.addBolus("s1", { id: "old", ts: "2026-10-13T12:00:00.000Z", units: "3", kind: "standard" });
  fake.addBolus("s2", {
    id: "other",
    ts: "2026-10-15T12:00:00.000Z",
    units: "4",
    kind: "standard",
  });
  fake.link("meal-lunch", "b3", "2026-10-15T12:05:00.000Z");
});

describe("loadPumpHistory (v0.7.0 plan §4)", () => {
  it("returns the space's boluses in the range oldest first, with the meal link, reach and status", async () => {
    const view = await loadPumpHistory("s1", FROM, TO, fake.db);
    expect(PumpHistoryView.parse(view)).toEqual(view);
    expect(view).toEqual({
      boluses: [
        { id: "b1", ts: "2026-10-15T03:10:00.000Z", units: 0.6, kind: "automatic" },
        { id: "b2", ts: "2026-10-15T07:30:00.000Z", units: 1.25, kind: "extended" },
        {
          id: "b3",
          ts: "2026-10-15T11:58:00.000Z",
          units: 2.4,
          kind: "standard",
          carbs: 45,
          mealId: "meal-lunch",
        },
      ],
      reach: "2026-10-15T11:58:00.000Z",
      status: "connected",
    });
  });

  it("passes units through from the stored Decimal unchanged, as numbers, and derives nothing", async () => {
    const view = await loadPumpHistory("s1", FROM, TO, fake.db);
    const stored = fake.boluses
      .filter((b) => view.boluses.some((v) => v.id === b.id))
      .map((b) => [b.id, b.units.toNumber()]);
    expect(view.boluses.map((b) => [b.id, b.units])).toEqual(expect.arrayContaining(stored));
    for (const bolus of view.boluses) expect(typeof bolus.units).toBe("number");
    // Nothing summed, averaged or compared: the view has the boluses, the reach and the status only.
    expect(Object.keys(view).sort()).toEqual(["boluses", "reach", "status"]);
  });

  it("never returns glucose, enteredBy or any key outside PumpBolusView, and never asks for them", async () => {
    const view = await loadPumpHistory("s1", FROM, TO, fake.db);
    const allowed = Object.keys(PumpBolusView.shape);
    for (const bolus of view.boluses)
      for (const key of Object.keys(bolus)) expect(allowed, key).toContain(key);
    const text = JSON.stringify(view);
    expect(text).not.toContain("glucose");
    expect(text).not.toContain("enteredBy");
    expect(text).not.toContain("tconnectsync");
    expect(text).not.toContain("sourceId");
    expect(text).not.toContain("pumpSource");
    expect(text).not.toContain("secretRef");
    expect(fake.selects).toEqual([
      { space: { pumpStatus: true, lastPumpAt: true } },
      {
        pumpBolus: {
          id: true,
          ts: true,
          units: true,
          kind: true,
          carbs: true,
          meals: { select: { id: true }, orderBy: { ts: "asc" }, take: 1 },
        },
      },
    ]);
  });

  it("answers an empty list without reach for a space that has no pump record", async () => {
    expect(
      await loadPumpHistory("s2", FROM, new Date("2026-10-15T11:00:00.000Z"), fake.db),
    ).toEqual({
      boluses: [],
      status: "not-configured",
    });
  });

  it("is 404 for a space that does not exist", async () => {
    await expect(loadPumpHistory("nope", FROM, TO, fake.db)).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
  });

  it("shows a stored kind the contract does not know as other, rather than failing the whole curve", async () => {
    fake.addBolus("s1", { id: "odd", ts: "2026-10-15T09:00:00.000Z", units: "1", kind: "square" });
    const view = await loadPumpHistory("s1", FROM, TO, fake.db);
    expect(view.boluses.find((b) => b.id === "odd")).toEqual({
      id: "odd",
      ts: "2026-10-15T09:00:00.000Z",
      units: 1,
      kind: "other",
    });
  });
});
