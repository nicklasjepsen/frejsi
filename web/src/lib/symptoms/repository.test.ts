// @vitest-environment node
import { describe, expect, it } from "vitest";
import { database } from "./test-support";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 12, minutes)).toISOString();

describe("PrismaSymptomRepository", () => {
  it("returns the space's rows in the inclusive range, oldest first, with the logger's name", async () => {
    const { repo } = database();
    await repo.create({ id: "y3", spaceId: "s1", byUserId: "child", ts: at(30), kind: "tired" });
    await repo.create({ id: "y1", spaceId: "s1", byUserId: "carer", ts: at(0), kind: "dizzy" });
    await repo.create({ id: "y2", spaceId: "s1", byUserId: "carer", ts: at(10), kind: "nausea" });
    await repo.create({ id: "y4", spaceId: "s1", byUserId: "carer", ts: at(31), kind: "shaky" });
    await repo.create({ id: "z1", spaceId: "s2", byUserId: "carer", ts: at(15), kind: "tired" });
    const rows = await repo.range("s1", at(0), at(30));
    expect(rows.map((r) => r.id)).toEqual(["y1", "y2", "y3"]);
    expect(rows[2]).toEqual({
      id: "y3",
      spaceId: "s1",
      byUserId: "child",
      byName: "Fictional child",
      ts: at(30),
      kind: "tired",
      severity: undefined,
      note: undefined,
      resolvedTs: undefined,
    });
  });
  it("updates fields, clears the resolved time with null, and keeps it on omission", async () => {
    const { repo } = database();
    await repo.create({ id: "y1", spaceId: "s1", byUserId: "carer", ts: at(0), kind: "dizzy" });
    const resolved = await repo.update("s1", "y1", {
      severity: "strong",
      note: "Fictional note",
      resolvedTs: at(20),
    });
    expect(resolved).toMatchObject({ severity: "strong", note: "Fictional note", resolvedTs: at(20) });
    expect(await repo.update("s1", "y1", { kind: "nausea" })).toMatchObject({
      kind: "nausea",
      resolvedTs: at(20),
    });
    expect(await repo.update("s1", "y1", { resolvedTs: null })).not.toHaveProperty(
      "resolvedTs",
      expect.any(String),
    );
  });
  it("answers symptom-not-found for another space's id on update and delete", async () => {
    const { repo } = database();
    await repo.create({ id: "y1", spaceId: "s1", byUserId: "carer", ts: at(0), kind: "dizzy" });
    await expect(repo.update("s2", "y1", { kind: "tired" })).rejects.toMatchObject({
      status: 404,
      code: "symptom-not-found",
    });
    await expect(repo.delete("s2", "y1")).rejects.toMatchObject({ code: "symptom-not-found" });
    expect(await repo.find("s2", "y1")).toBeNull();
    await repo.delete("s1", "y1");
    expect(await repo.find("s1", "y1")).toBeNull();
  });
  it("reads the space's own kinds and a meal's instant, null for an unknown space or meal", async () => {
    const kinds = [{ id: "custom:itchy", label: { da: "Kloe", en: "Itchy" } }];
    const { repo } = database({
      symptomKinds: JSON.stringify(kinds),
      meals: { m1: new Date(at(0)) },
    });
    expect(await repo.spaceKinds("s1")).toEqual(kinds);
    expect(await repo.spaceKinds("missing")).toBeNull();
    expect(await repo.mealTs("s1", "m1")).toBe(at(0));
    expect(await repo.mealTs("s1", "m2")).toBeNull();
    expect(await repo.mealTs("s2", "m1")).toBeNull();
  });
});
