// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EventEnvelope, EventPayloads, SessionContext, type EmitFn } from "@frejsi/shared";
import {
  createSymptom,
  deleteSymptom,
  listSymptoms,
  symptomsAroundMeal,
  updateSymptom,
} from "./service";
import { database } from "./test-support";

const now = new Date();
const minutes = (n: number) => new Date(now.getTime() + n * 60_000).toISOString();
const member = (userId: string, simpleMode = false) =>
  SessionContext.parse({
    userId,
    name: `Fictional ${userId}`,
    simpleMode,
    accent: "olive",
    theme: "system",
    locale: "da",
    memberships: [{ spaceId: "s1", role: userId === "owner" ? "owner" : "carer" }],
  });
const carer = member("carer");
const child = member("child", true);
function setup(options: Parameters<typeof database>[0] = {}) {
  const { repo, rows } = database(options);
  const events: { type: string; payload: unknown }[] = [];
  const emit: EmitFn = (spaceId, type, payload) => {
    events.push({ type, payload });
    return Promise.resolve(
      EventEnvelope.parse({
        spaceId,
        seq: events.length,
        type,
        payload: EventPayloads[type].parse(payload),
        ts: now.toISOString(),
      }),
    );
  };
  const deps = {
    repo,
    write: <T>(work: (r: typeof repo, e: EmitFn) => Promise<T>) => work(repo, emit),
    now: () => now,
  };
  return { deps, events, rows };
}

describe("symptom service", () => {
  it("creates at now by default, emits symptom.created with id, ts, kind and who, and answers the view", async () => {
    const { deps, events } = setup();
    const saved = await createSymptom("s1", carer, { kind: "stomach-ache" }, deps);
    expect(saved).toEqual({
      id: saved.id,
      kind: "stomach-ache",
      ts: now.toISOString(),
      byUserId: "carer",
      byName: "Fictional carer",
    });
    expect(events).toEqual([
      {
        type: "symptom.created",
        payload: { symptomId: saved.id, ts: now.toISOString(), kind: "stomach-ache", byUserId: "carer" },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/note|severity/);
  });
  it("keeps a given time, severity and note for an owner or carer", async () => {
    const { deps } = setup();
    const saved = await createSymptom(
      "s1",
      carer,
      { kind: "dizzy", ts: minutes(-30), severity: "light", note: "Fictional note" },
      deps,
    );
    expect(saved).toMatchObject({ ts: minutes(-30), severity: "light", note: "Fictional note" });
  });
  it("lets a simpleMode session create a kind and nothing else", async () => {
    const { deps, events } = setup();
    const saved = await createSymptom("s1", child, { kind: "tired" }, deps);
    expect(saved).toMatchObject({ kind: "tired", ts: now.toISOString(), byName: "Fictional child" });
    for (const body of [
      { kind: "tired", severity: "light" },
      { kind: "tired", note: "x" },
      { kind: "tired", ts: minutes(-5) },
    ])
      await expect(createSymptom("s1", child, body, deps)).rejects.toMatchObject({
        status: 400,
        code: "simple-mode",
      });
    await expect(
      updateSymptom("s1", saved.id, child, { severity: "strong" }, deps),
    ).rejects.toMatchObject({ code: "simple-mode" });
    await expect(deleteSymptom("s1", saved.id, child, deps)).rejects.toMatchObject({
      code: "simple-mode",
    });
    expect(events).toHaveLength(1);
  });
  it("refuses a kind outside the defaults and the space's kinds, and accepts a declared custom one", async () => {
    const custom = setup({
      symptomKinds: JSON.stringify([{ id: "custom:itchy", label: { da: "Kloe", en: "Itchy" } }]),
    });
    await expect(createSymptom("s1", carer, { kind: "custom:other" }, custom.deps)).rejects.toMatchObject({
      status: 400,
      code: "symptom-kind-unknown",
    });
    await expect(createSymptom("s1", carer, { kind: "sad" }, custom.deps)).rejects.toMatchObject({
      code: "validation",
    });
    const saved = await createSymptom("s1", carer, { kind: "custom:itchy" }, custom.deps);
    expect(saved.kind).toBe("custom:itchy");
    await expect(
      updateSymptom("s1", saved.id, carer, { kind: "custom:nope" }, custom.deps),
    ).rejects.toMatchObject({ code: "symptom-kind-unknown" });
    expect(custom.events.map((e) => e.type)).toEqual(["symptom.created"]);
  });
  it("updates and deletes with one event each; a carer deletes what the child logged", async () => {
    const { deps, events, rows } = setup();
    const mine = await createSymptom("s1", child, { kind: "nausea" }, deps);
    const updated = await updateSymptom(
      "s1",
      mine.id,
      carer,
      { severity: "medium", resolvedTs: minutes(5) },
      deps,
    );
    expect(updated).toMatchObject({ severity: "medium", resolvedTs: minutes(5), byUserId: "child" });
    await deleteSymptom("s1", mine.id, carer, deps);
    expect(rows.size).toBe(0);
    expect(events.map((e) => e.type)).toEqual([
      "symptom.created",
      "symptom.updated",
      "symptom.deleted",
    ]);
    await expect(updateSymptom("s1", mine.id, carer, { kind: "tired" }, deps)).rejects.toMatchObject({
      status: 404,
      code: "symptom-not-found",
    });
    await expect(deleteSymptom("s1", mine.id, carer, deps)).rejects.toMatchObject({
      code: "symptom-not-found",
    });
  });
  it("lists the range inclusive, oldest first, and refuses a range over eight days", async () => {
    const { deps } = setup();
    await createSymptom("s1", carer, { kind: "tired", ts: minutes(-20) }, deps);
    await createSymptom("s1", carer, { kind: "dizzy", ts: minutes(-10) }, deps);
    const listed = await listSymptoms("s1", { from: minutes(-20), to: minutes(-10) }, deps);
    expect(listed.symptoms.map((s) => s.kind)).toEqual(["tired", "dizzy"]);
    expect(Object.keys(listed.symptoms[0] ?? {}).sort()).toEqual([
      "byName",
      "byUserId",
      "id",
      "kind",
      "ts",
    ]);
    await expect(
      listSymptoms("s1", { from: minutes(-9 * 24 * 60), to: minutes(0) }, deps),
    ).rejects.toMatchObject({ code: "validation" });
  });
  it("finds the symptoms from an hour before to four hours after a meal, as kind and instant only", async () => {
    const mealTs = new Date(now.getTime() - 6 * 60 * 60_000);
    const { deps } = setup({ meals: { m1: mealTs } });
    const at = (n: number) => new Date(mealTs.getTime() + n * 60_000).toISOString();
    for (const [kind, ts, note] of [
      ["dizzy", at(-61), "before"],
      ["tired", at(-60), "edge"],
      ["nausea", at(90), "Fictional note"],
      ["shaky", at(240), "edge"],
      ["headache", at(241), "after"],
    ] as const)
      await createSymptom("s1", carer, { kind, ts, note }, deps);
    expect(await symptomsAroundMeal("s1", "m1", deps)).toEqual([
      { kind: "tired", ts: at(-60) },
      { kind: "nausea", ts: at(90) },
      { kind: "shaky", ts: at(240) },
    ]);
    expect(await symptomsAroundMeal("s1", "missing", deps)).toEqual([]);
  });
});
