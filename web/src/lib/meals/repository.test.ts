// @vitest-environment node
import { describe, expect, it } from "vitest";
import { database } from "./test-support";
const at = new Date("2026-10-15T05:15:00.000Z");

describe("Prisma meal persistence", () => {
  it("round-trips ordered snapshots, replaces rows atomically and scopes reads, updates and deletes", async () => {
    const { repo, rows } = database();
    const saved = await repo.create({
      id: "m1",
      spaceId: "s1",
      byUserId: "u1",
      ts: at.toISOString(),
      totalCarbs: 25,
      symbol: "bread",
      items: [
        { name: "Toast", foodId: "f1", grams: 30, portionLabel: "slice", carbs: 13 },
        { name: "Berries", carbs: 12 },
      ],
    });
    // A database may return physical row order unrelated to creation order.
    rows.get("m1")?.items.reverse();
    expect(await repo.find("s1", "m1")).toEqual(saved);
    expect(await repo.lock("s1", "m1")).toEqual(saved);
    expect(saved).toMatchObject({
      timezone: "Europe/Copenhagen",
      byUser: { id: "u1" },
      symbol: "bread",
      items: [
        { name: "Toast", grams: 30, carbs: 13 },
        { name: "Berries", carbs: 12 },
      ],
    });
    const replaced = await repo.update("s1", "m1", {
      items: [{ name: "Oats", carbs: 9 }],
      totalCarbs: 9,
      note: "Fictional note",
      bolusTs: at.toISOString(),
      photoKey: "spaces/s1/meals/m1/photo",
    });
    expect(replaced.items).toEqual([
      { name: "Oats", foodId: undefined, grams: undefined, portionLabel: undefined, carbs: 9 },
    ]);
    expect(replaced.totalCarbs).toBe(9);
    expect(replaced.symbol).toBe("bread");
    expect(replaced.bolusTs).toBe(at.toISOString());
    expect((await repo.update("s1", "m1", { symbol: "unknown" })).symbol).toBe("unknown");
    expect(rows.get("m1")?.symbol).toBe("unknown");
    expect((await repo.update("s1", "m1", { note: "Fictional edit" })).bolusTs).toBe(
      at.toISOString(),
    );
    expect((await repo.update("s1", "m1", { bolusTs: null })).bolusTs).toBeUndefined();
    expect(rows.get("m1")?.bolusTs).toBeNull();
    expect((await repo.find("s1", "m1"))?.bolusTs).toBeUndefined();
    expect((await repo.update("s1", "m1", { photoKey: undefined })).photoKey).toBeUndefined();
    expect(await repo.find("s2", "m1")).toBeNull();
    await expect(repo.lock("s2", "m1")).rejects.toMatchObject({ code: "not-found" });
    await expect(repo.update("s2", "m1", { note: "Wrong space" })).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(repo.delete("s2", "m1")).rejects.toMatchObject({ code: "not-found" });
    expect(await repo.find("s1", "m1")).not.toBeNull();
    await repo.delete("s1", "m1");
    expect(await repo.find("s1", "m1")).toBeNull();
  });
  it("reads a row saved before 0005, or a stale value, as the unknown symbol", async () => {
    const { repo, rows } = database();
    await repo.create({
      id: "m-old",
      spaceId: "s1",
      byUserId: "u1",
      ts: at.toISOString(),
      totalCarbs: 5,
      symbol: "fruit",
      items: [{ name: "Apple", carbs: 5 }],
    });
    const row = rows.get("m-old");
    if (!row) throw new Error("missing row");
    row.symbol = null;
    expect((await repo.find("s1", "m-old"))?.symbol).toBe("unknown");
    row.symbol = "stale";
    expect((await repo.find("s1", "m-old"))?.symbol).toBe("unknown");
  });
  it("maps decimal nutrition and portions and cannot read a cache or other-space food", async () => {
    const { repo, food } = database();
    expect(await repo.food("s1", "f1")).toMatchObject({
      name: "Fictional toast",
      carbsPer100g: 41,
      portions: [{ label: "slice", grams: 30, carbs: 13 }],
      verified: false,
      category: "bread",
    });
    expect((await repo.food("s1", "f1"))?.recipe).toBeUndefined();
    expect(await repo.food("s2", "f1")).toBeNull();
    food.spaceId = "cache";
    expect(await repo.food("s1", "f1")).toBeNull();
  });
});
