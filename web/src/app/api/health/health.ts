import { type Health, type PrismaClient } from "@frejsi/shared";

/** A reading newer than this is `fresh`; matches the 35-minute alert in Bicep (plan §9). */
export const FRESH_READING_MINUTES = 35;

/** The two things the endpoint asks Prisma for; the route passes the real client. */
export type HealthDb = Pick<PrismaClient, "$queryRaw"> & {
  reading: { findFirst: PrismaClient["reading"]["findFirst"] };
};

export interface HealthDeps {
  db: HealthDb;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

/**
 * A coarse state and nothing else: no timestamp, no value, no space id (plan decision 22). `ok`
 * is true when the database answers; the readings state is informational for the release smoke.
 */
export async function computeHealth({
  db,
  now = () => new Date(),
  env = process.env,
}: HealthDeps): Promise<Health> {
  const version = env.NEXT_PUBLIC_APP_VERSION ?? "dev";
  try {
    await db.$queryRaw`SELECT 1 AS ok`;
    const latest = await db.reading.findFirst({ orderBy: { ts: "desc" }, select: { ts: true } });
    let readings: Health["readings"] = "none";
    if (latest) {
      const ageMinutes = (now().getTime() - latest.ts.getTime()) / 60_000;
      readings = ageMinutes <= FRESH_READING_MINUTES ? "fresh" : "stale";
    }
    return { ok: true, version, db: "ok", readings };
  } catch {
    return { ok: false, version, db: "error", readings: "none" };
  }
}
