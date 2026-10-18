// An in-memory stand-in for the two delegates `loadPumpHistory` reads: the space's pump status and
// the stored boluses with their meal links. Records every `select` it was asked for, so a test can
// prove the read never asks for a field outside `PumpBolusView`. Imported by *.test.ts only.
import { Prisma } from "@frejsi/shared";

import type { PumpReadDb } from "./history";

export interface FakeBolus {
  id: string;
  spaceId: string;
  sourceId: string;
  ts: Date;
  units: Prisma.Decimal;
  kind: string;
  carbs: number | null;
  mealDismissed: boolean;
  createdAt: Date;
  /** Fields a stored row never has; present here so a leak through a spread would show. */
  glucose?: number;
  enteredBy?: string;
}

export interface FakeLink {
  id: string;
  pumpBolusId: string;
  ts: Date;
}

export interface FakePumpSpace {
  id: string;
  pumpStatus: string;
  lastPumpAt: Date | null;
  pumpSource?: string | null;
}

export class FakePumpDb {
  readonly spaces: FakePumpSpace[] = [];
  readonly boluses: FakeBolus[] = [];
  readonly links: FakeLink[] = [];
  readonly selects: unknown[] = [];

  addSpace(space: FakePumpSpace): void {
    this.spaces.push(space);
  }

  addBolus(
    spaceId: string,
    bolus: { id: string; ts: string; units: string; kind: string; carbs?: number },
  ): void {
    this.boluses.push({
      id: bolus.id,
      spaceId,
      sourceId: `src-${bolus.id}`,
      ts: new Date(bolus.ts),
      units: new Prisma.Decimal(bolus.units),
      kind: bolus.kind,
      carbs: bolus.carbs ?? null,
      mealDismissed: false,
      createdAt: new Date(bolus.ts),
      glucose: 7.4,
      enteredBy: "tconnectsync",
    });
  }

  link(mealId: string, pumpBolusId: string, ts: string): void {
    this.links.push({ id: mealId, pumpBolusId, ts: new Date(ts) });
  }

  get db(): PumpReadDb {
    const pick = (row: object, select: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => select[key] === true || key in select),
      );
    return {
      space: {
        findUnique: (args: { where: { id: string }; select: Record<string, true> }) => {
          this.selects.push({ space: args.select });
          const space = this.spaces.find((s) => s.id === args.where.id);
          return Promise.resolve(space ? pick(space, args.select) : null);
        },
      },
      pumpBolus: {
        findMany: (args: {
          where: { spaceId: string; ts: { gte: Date; lte: Date } };
          orderBy: { ts: "asc" };
          select: Record<string, unknown>;
        }) => {
          this.selects.push({ pumpBolus: args.select });
          const { spaceId, ts } = args.where;
          const rows = this.boluses
            .filter(
              (b) =>
                b.spaceId === spaceId &&
                b.ts.getTime() >= ts.gte.getTime() &&
                b.ts.getTime() <= ts.lte.getTime(),
            )
            .toSorted((a, b) => a.ts.getTime() - b.ts.getTime())
            .map((b) => {
              const row: Record<string, unknown> = pick(b, args.select);
              if ("meals" in args.select) {
                row.meals = this.links
                  .filter((l) => l.pumpBolusId === b.id)
                  .toSorted((x, y) => x.ts.getTime() - y.ts.getTime())
                  .map((l) => ({ id: l.id }));
              }
              return row;
            });
          return Promise.resolve(rows);
        },
      },
    } as unknown as PumpReadDb;
  }
}
