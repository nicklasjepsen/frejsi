import type { PrismaClient } from "@naensom/shared";

/**
 * One `LiveSubscription` row (shared/prisma/schema.prisma, plan 2026-11-08-ios-follower-app §5).
 * The relay keeps no reading history: only the newest reading's time.
 */
export interface LiveRow {
  id: string;
  deviceSecretHash: string;
  isDemo: boolean;
  nightscoutHost: string | null;
  tokenSecretRef: string | null;
  apnsEnvironment: string;
  pushToStartToken: string | null;
  activityPushToken: string | null;
  activityStartedAt: Date | null;
  deviceToken: string | null;
  unit: string;
  language: string;
  urgentLowMgdl: number;
  lowMgdl: number;
  highMgdl: number;
  urgentHighMgdl: number;
  alertsOn: boolean;
  lastAlertKind: string | null;
  lastAlertAt: Date | null;
  lastReadingAt: Date | null;
  lastPushAt: Date | null;
  nextCheckAt: Date;
  failures: number;
  createdAt: Date;
  lastSeenAt: Date;
}

export type LivePatch = Partial<Omit<LiveRow, "id" | "createdAt" | "deviceSecretHash">>;

/** The relay's database slice; tests pass an in-memory one. */
export interface LiveStore {
  create(row: LiveRow): Promise<void>;
  get(id: string): Promise<LiveRow | null>;
  /**
   * Writes `patch` when the row exists and still matches `expect` (a token the relay is about to
   * clear may have been replaced by a newer registration meanwhile). Answers whether it wrote.
   */
  update(id: string, patch: LivePatch, expect?: LivePatch): Promise<boolean>;
  /** Deletes the row; a row that is already gone is fine. */
  delete(id: string): Promise<void>;
  /** The rows whose next check is at or before `before`, oldest first. */
  due(before: Date, limit: number): Promise<LiveRow[]>;
  /** Rows no push was accepted for and no registration came from since `before`. */
  idle(before: Date, limit: number): Promise<LiveRow[]>;
}

/** The Prisma implementation; a schema change that breaks it fails to compile here. */
export class PrismaLiveStore implements LiveStore {
  constructor(private readonly db: Pick<PrismaClient, "liveSubscription">) {}

  async create(row: LiveRow): Promise<void> {
    await this.db.liveSubscription.create({ data: row });
  }

  get(id: string): Promise<LiveRow | null> {
    return this.db.liveSubscription.findUnique({ where: { id } });
  }

  async update(id: string, patch: LivePatch, expect: LivePatch = {}): Promise<boolean> {
    const { count } = await this.db.liveSubscription.updateMany({
      where: { ...expect, id },
      data: patch,
    });
    return count > 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.liveSubscription.deleteMany({ where: { id } });
  }

  due(before: Date, limit: number): Promise<LiveRow[]> {
    return this.db.liveSubscription.findMany({
      where: { nextCheckAt: { lte: before } },
      orderBy: { nextCheckAt: "asc" },
      take: limit,
    });
  }

  idle(before: Date, limit: number): Promise<LiveRow[]> {
    return this.db.liveSubscription.findMany({
      where: { lastSeenAt: { lt: before } },
      orderBy: { lastSeenAt: "asc" },
      take: limit,
    });
  }
}

/** In memory, for tests and the local CLI. */
export class MemoryLiveStore implements LiveStore {
  readonly rows = new Map<string, LiveRow>();

  create(row: LiveRow): Promise<void> {
    if (this.rows.has(row.id)) return Promise.reject(new Error("duplicate id"));
    this.rows.set(row.id, { ...row });
    return Promise.resolve();
  }

  get(id: string): Promise<LiveRow | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : null);
  }

  update(id: string, patch: LivePatch, expect: LivePatch = {}): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return Promise.resolve(false);
    for (const [key, value] of Object.entries(expect)) {
      const comparable = (v: unknown) => (v instanceof Date ? v.getTime() : v);
      if (comparable(row[key as keyof LiveRow]) !== comparable(value)) {
        return Promise.resolve(false);
      }
    }
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => (value as unknown) !== undefined),
    ) as LivePatch;
    this.rows.set(id, { ...row, ...defined });
    return Promise.resolve(true);
  }

  delete(id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }

  due(before: Date, limit: number): Promise<LiveRow[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.nextCheckAt.getTime() <= before.getTime())
        .sort((a, b) => a.nextCheckAt.getTime() - b.nextCheckAt.getTime())
        .slice(0, limit)
        .map((row) => ({ ...row })),
    );
  }

  idle(before: Date, limit: number): Promise<LiveRow[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.lastSeenAt.getTime() < before.getTime())
        .slice(0, limit)
        .map((row) => ({ ...row })),
    );
  }
}
