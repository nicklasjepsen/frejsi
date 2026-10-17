// In-memory SQL delegates for the symptom repository, service and transaction tests. Imported by
// *.test.ts and the route tests only. Fictional people throughout.
import type { PrismaClient } from "@frejsi/shared";
import { PrismaSymptomRepository, type SymptomDb } from "./repository";

export interface Row {
  id: string;
  spaceId: string;
  byUserId: string;
  ts: Date;
  kind: string;
  severity: string | null;
  note: string | null;
  resolvedTs: Date | null;
}
export const NAMES: Record<string, string> = {
  owner: "Fictional owner",
  carer: "Fictional carer",
  child: "Fictional child",
  viewer: "Fictional viewer",
};
interface Where {
  id?: string;
  spaceId: string;
  ts?: { gte: Date; lte: Date };
}
export function database(options: { symptomKinds?: string; meals?: Record<string, Date> } = {}) {
  const rows = new Map<string, Row>();
  const read = (row: Row | undefined) =>
    row ? { ...row, byUser: { name: NAMES[row.byUserId] ?? "Fictional member" } } : null;
  const matches = (row: Row, where: Where) =>
    row.spaceId === where.spaceId &&
    (where.id === undefined || row.id === where.id) &&
    (where.ts === undefined ||
      (row.ts.getTime() >= where.ts.gte.getTime() && row.ts.getTime() <= where.ts.lte.getTime()));
  const db = {
    space: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === "s1" || where.id === "s2"
            ? { symptomKinds: options.symptomKinds ?? "[]" }
            : null,
        ),
    },
    meal: {
      findFirst: ({ where }: { where: { id: string; spaceId: string } }) => {
        const ts = options.meals?.[where.id];
        return Promise.resolve(ts && where.spaceId === "s1" ? { ts } : null);
      },
    },
    symptom: {
      create: ({ data }: { data: Row }) => {
        rows.set(data.id, { ...data });
        return Promise.resolve(read(rows.get(data.id)));
      },
      findFirst: ({ where }: { where: Where }) =>
        Promise.resolve(read([...rows.values()].find((row) => matches(row, where)))),
      findMany: ({ where }: { where: Where }) =>
        Promise.resolve(
          [...rows.values()]
            .filter((row) => matches(row, where))
            .sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.id.localeCompare(b.id))
            .map((row) => read(row)),
        ),
      update: ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const row = rows.get(where.id ?? "");
        if (!row || !matches(row, where))
          return Promise.reject(Object.assign(new Error("missing"), { code: "P2025" }));
        const next = { ...row, ...data };
        rows.set(row.id, next);
        return Promise.resolve(read(next));
      },
      deleteMany: ({ where }: { where: Where }) => {
        const row = rows.get(where.id ?? "");
        if (!row || !matches(row, where)) return Promise.resolve({ count: 0 });
        rows.delete(row.id);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return {
    rows,
    db,
    repo: new PrismaSymptomRepository(db as unknown as SymptomDb),
  };
}
export type { PrismaClient };
