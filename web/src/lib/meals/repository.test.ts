// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@frejsi/shared";
import { PrismaMealRepository } from "./repository";

const at = new Date("2026-10-15T05:15:00.000Z");
interface Item {
  name: string;
  grams: number | null;
  portionLabel: string | null;
  foodId: string | null;
  carbs: number;
  position: number;
}
interface Row {
  id: string;
  spaceId: string;
  byUserId: string;
  ts: Date;
  totalCarbs: number;
  note: string | null;
  photoKey: string | null;
  bolusTs: Date | null;
  items: Item[];
}
function database() {
  const rows = new Map<string, Row>();
  const food = {
    id: "f1",
    spaceId: "s1",
    name: "Fictional toast",
    nameSearch: "fictional toast",
    origin: "family",
    sourceRef: "family:f1",
    verified: false,
    favourite: false,
    carbsPer100g: { toNumber: () => 41 },
    portions: '[{"label":"slice","grams":30,"carbs":13}]',
    createdAt: at,
    updatedAt: at,
    barcode: null,
    photoKey: null,
    verifiedBy: null,
    verifiedAt: null,
    createdBy: null,
  };
  function read(
    row: Row | undefined,
    args: { include: { items: { orderBy: { position: string } } } },
  ) {
    if (!row) return null;
    const direction = args.include.items.orderBy.position === "asc" ? 1 : -1;
    return {
      ...row,
      byUser: { id: row.byUserId, name: "Fictional carer" },
      space: { timezone: "Europe/Copenhagen" },
      items: [...row.items]
        .sort((a, b) => direction * (a.position - b.position))
        .map((item) => ({
          ...item,
          grams: item.grams === null ? null : { toNumber: () => item.grams },
        })),
    };
  }
  const db = {
    food: {
      findFirst: ({ where }: { where: { id: string; spaceId: string } }) =>
        Promise.resolve(food.id === where.id && food.spaceId === where.spaceId ? food : null),
    },
    meal: {
      create: (args: {
        data: Omit<Row, "items"> & { items: { create: Item[] } };
        include: { items: { orderBy: { position: string } } };
      }) => {
        const row = { ...args.data, items: args.data.items.create };
        rows.set(row.id, row);
        return Promise.resolve(read(row, args));
      },
      findFirst: (args: {
        where: { id: string; spaceId: string };
        include: { items: { orderBy: { position: string } } };
      }) => {
        const row = rows.get(args.where.id);
        return Promise.resolve(read(row?.spaceId === args.where.spaceId ? row : undefined, args));
      },
      update: (args: {
        where: { id: string; spaceId: string };
        data: Partial<Omit<Row, "items">> & { items?: { create: Item[]; deleteMany?: object } };
        include: { items: { orderBy: { position: string } } };
      }) => {
        const row = rows.get(args.where.id);
        if (row?.spaceId !== args.where.spaceId)
          return Promise.reject(Object.assign(new Error("missing"), { code: "P2025" }));
        const { items, ...fields } = args.data;
        const next = {
          ...row,
          ...fields,
          items: items ? [...(items.deleteMany ? [] : row.items), ...items.create] : row.items,
        };
        rows.set(row.id, next);
        return Promise.resolve(read(next, args));
      },
      deleteMany: ({ where }: { where: { id: string; spaceId: string } }) => {
        const row = rows.get(where.id);
        if (row?.spaceId !== where.spaceId) return Promise.resolve({ count: 0 });
        rows.delete(where.id);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return {
    rows,
    food,
    repo: new PrismaMealRepository(db as unknown as Pick<PrismaClient, "meal" | "food">),
  };
}

describe("Prisma meal persistence", () => {
  it("round-trips ordered snapshots, replaces rows atomically and scopes reads, updates and deletes", async () => {
    const { repo, rows } = database();
    const saved = await repo.create({
      id: "m1",
      spaceId: "s1",
      byUserId: "u1",
      ts: at.toISOString(),
      totalCarbs: 25,
      items: [
        { name: "Toast", foodId: "f1", grams: 30, portionLabel: "slice", carbs: 13 },
        { name: "Berries", carbs: 12 },
      ],
    });
    // A database may return physical row order unrelated to creation order.
    rows.get("m1")?.items.reverse();
    expect(await repo.find("s1", "m1")).toEqual(saved);
    expect(saved).toMatchObject({
      timezone: "Europe/Copenhagen",
      byUser: { id: "u1" },
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
    expect(replaced.bolusTs).toBe(at.toISOString());
    expect((await repo.update("s1", "m1", { photoKey: undefined })).photoKey).toBeUndefined();
    expect(await repo.find("s2", "m1")).toBeNull();
    await expect(repo.update("s2", "m1", { note: "Wrong space" })).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(repo.delete("s2", "m1")).rejects.toMatchObject({ code: "not-found" });
    expect(await repo.find("s1", "m1")).not.toBeNull();
    await repo.delete("s1", "m1");
    expect(await repo.find("s1", "m1")).toBeNull();
  });
  it("maps decimal nutrition and portions and cannot read a cache or other-space food", async () => {
    const { repo, food } = database();
    expect(await repo.food("s1", "f1")).toMatchObject({
      name: "Fictional toast",
      carbsPer100g: 41,
      portions: [{ label: "slice", grams: 30, carbs: 13 }],
      verified: false,
    });
    expect(await repo.food("s2", "f1")).toBeNull();
    food.spaceId = "cache";
    expect(await repo.food("s1", "f1")).toBeNull();
  });
});
