import { HttpError, parseSpaceKinds, prisma, type PrismaClient } from "@frejsi/shared";
import type { Severity, SpaceSymptomKind, SymptomKind } from "@frejsi/shared";

/** A symptom as stored, with the logger's name. Never a reading: a viewer may read it. */
export interface SymptomRecord {
  id: string;
  spaceId: string;
  byUserId: string;
  byName: string;
  ts: string;
  kind: SymptomKind;
  severity?: Severity | undefined;
  note?: string | undefined;
  resolvedTs?: string | undefined;
}
export interface SymptomData {
  id: string;
  spaceId: string;
  byUserId: string;
  ts: string;
  kind: SymptomKind;
  severity?: Severity | undefined;
  note?: string | undefined;
}
export interface SymptomChanges {
  ts?: string | undefined;
  kind?: SymptomKind | undefined;
  severity?: Severity | undefined;
  note?: string | undefined;
  /** Null clears the resolved time; undefined leaves it. */
  resolvedTs?: string | null | undefined;
}
export interface SymptomRepository {
  /** The space's own kinds; null when there is no such space. */
  spaceKinds(spaceId: string): Promise<SpaceSymptomKind[] | null>;
  /** The instant of a meal in the space, for the symptoms around it; null when there is none. */
  mealTs(spaceId: string, mealId: string): Promise<string | null>;
  find(spaceId: string, id: string): Promise<SymptomRecord | null>;
  /** The space's symptoms with `from <= ts <= to`, oldest first. */
  range(spaceId: string, from: string, to: string): Promise<SymptomRecord[]>;
  create(data: SymptomData): Promise<SymptomRecord>;
  update(spaceId: string, id: string, changes: SymptomChanges): Promise<SymptomRecord>;
  delete(spaceId: string, id: string): Promise<void>;
}

const include = { byUser: { select: { name: true } } };
type SymptomRow = NonNullable<Awaited<ReturnType<PrismaSymptomRepository["readRow"]>>>;
function record(row: SymptomRow): SymptomRecord {
  return {
    id: row.id,
    spaceId: row.spaceId,
    byUserId: row.byUserId,
    byName: row.byUser.name,
    ts: row.ts.toISOString(),
    kind: row.kind,
    severity: (row.severity as Severity | null) ?? undefined,
    note: row.note ?? undefined,
    resolvedTs: row.resolvedTs?.toISOString(),
  };
}
function notFound(error: unknown): never {
  if (error instanceof Error && "code" in error && error.code === "P2025")
    throw new HttpError(404, "symptom-not-found");
  throw error;
}

export type SymptomDb = Pick<PrismaClient, "symptom" | "space" | "meal">;

/** Every query is scoped to the requested space; an id from another space is "not found". */
export class PrismaSymptomRepository implements SymptomRepository {
  constructor(private readonly db: SymptomDb = prisma) {}
  async spaceKinds(spaceId: string): Promise<SpaceSymptomKind[] | null> {
    const space = await this.db.space.findUnique({
      where: { id: spaceId },
      select: { symptomKinds: true },
    });
    return space ? parseSpaceKinds(space.symptomKinds) : null;
  }
  async mealTs(spaceId: string, mealId: string): Promise<string | null> {
    const meal = await this.db.meal.findFirst({
      where: { id: mealId, spaceId },
      select: { ts: true },
    });
    return meal ? meal.ts.toISOString() : null;
  }
  readRow(spaceId: string, id: string) {
    return this.db.symptom.findFirst({ where: { id, spaceId }, include });
  }
  async find(spaceId: string, id: string): Promise<SymptomRecord | null> {
    const row = await this.readRow(spaceId, id);
    return row ? record(row) : null;
  }
  async range(spaceId: string, from: string, to: string): Promise<SymptomRecord[]> {
    const rows = await this.db.symptom.findMany({
      where: { spaceId, ts: { gte: new Date(from), lte: new Date(to) } },
      orderBy: [{ ts: "asc" }, { id: "asc" }],
      include,
    });
    return rows.map(record);
  }
  async create(data: SymptomData): Promise<SymptomRecord> {
    return record(
      await this.db.symptom.create({
        data: {
          id: data.id,
          spaceId: data.spaceId,
          byUserId: data.byUserId,
          ts: new Date(data.ts),
          kind: data.kind,
          severity: data.severity ?? null,
          note: data.note ?? null,
        },
        include,
      }),
    );
  }
  async update(spaceId: string, id: string, changes: SymptomChanges): Promise<SymptomRecord> {
    try {
      return record(
        await this.db.symptom.update({
          where: { id, spaceId },
          data: {
            ...(changes.ts !== undefined ? { ts: new Date(changes.ts) } : {}),
            ...(changes.kind !== undefined ? { kind: changes.kind } : {}),
            ...(changes.severity !== undefined ? { severity: changes.severity } : {}),
            ...(changes.note !== undefined ? { note: changes.note } : {}),
            ...(changes.resolvedTs !== undefined
              ? { resolvedTs: changes.resolvedTs === null ? null : new Date(changes.resolvedTs) }
              : {}),
          },
          include,
        }),
      );
    } catch (error) {
      notFound(error);
    }
  }
  async delete(spaceId: string, id: string): Promise<void> {
    const result = await this.db.symptom.deleteMany({ where: { id, spaceId } });
    if (result.count === 0) throw new HttpError(404, "symptom-not-found");
  }
}
