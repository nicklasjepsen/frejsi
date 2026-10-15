// In-memory SQL delegates for meal adapter and transaction regression tests.
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
export function database() {
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
    db,
    repo: new PrismaMealRepository(db as unknown as Pick<PrismaClient, "meal" | "food">),
  };
}
