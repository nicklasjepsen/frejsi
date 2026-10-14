import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __frejsiPrisma?: PrismaClient };

/**
 * One client per process. Next.js dev reloads modules; keeping the instance on `globalThis`
 * stops a connection per reload. The URL comes from `DATABASE_URL` (plan §7).
 */
export const prisma: PrismaClient =
  globalForPrisma.__frejsiPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__frejsiPrisma = prisma;
}

export type { PrismaClient } from "@prisma/client";
