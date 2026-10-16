// A throwaway database next to the one `DATABASE_URL` names: created empty, migrated on request,
// dropped afterwards. The integration tests never write to the database the URL points at.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const SHARED = path.resolve(import.meta.dirname, "../..");
export const SCHEMA = path.join(SHARED, "prisma/schema.prisma");
// The workspace's flat node_modules (.npmrc node-linker=hoisted) keeps bins at the root.
const PRISMA_BIN =
  [SHARED, path.dirname(SHARED)]
    .map((dir) => path.join(dir, "node_modules/.bin/prisma"))
    .find((file) => existsSync(file)) ?? path.join(SHARED, "node_modules/.bin/prisma");

/** The URL from the environment; the suite cannot run without it. */
export function baseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the integration tests (plan §8)");
  return url;
}

/** The same server and credentials with another database (`database=` in Prisma's SQL Server URL). */
export function withDatabase(url: string, database: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error("unsafe database name");
  const parts = url.split(";").filter((part) => !/^database=/i.test(part.trim()));
  const [server, ...rest] = parts;
  return [server, `database=${database}`, ...rest].join(";");
}

async function onMaster<T>(fn: (master: PrismaClient) => Promise<T>): Promise<T> {
  const master = new PrismaClient({ datasourceUrl: withDatabase(baseUrl(), "master") });
  try {
    return await fn(master);
  } finally {
    await master.$disconnect();
  }
}

export interface ScratchDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

/** Creates an empty database with a random name. */
export async function createEmptyDatabase(prefix = "frejsi_it"): Promise<ScratchDatabase> {
  const name = `${prefix}_${randomBytes(4).toString("hex")}`;
  await onMaster((master) => master.$executeRawUnsafe(`CREATE DATABASE [${name}]`));
  await onMaster((master) =>
    master.$executeRawUnsafe(`ALTER DATABASE [${name}] SET COMPATIBILITY_LEVEL = 170`),
  );
  return {
    name,
    url: withDatabase(baseUrl(), name),
    drop: () =>
      onMaster(async (master) => {
        await master.$executeRawUnsafe(
          `IF DB_ID('${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END`,
        );
      }),
  };
}

/** Runs the Prisma CLI from shared/ against `url`; throws with its output when it fails. */
export function prismaCli(args: string[], url: string): string {
  try {
    return execFileSync(PRISMA_BIN, args, {
      cwd: SHARED,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string };
    const redact = (value: string) =>
      value.replaceAll(url, "[database URL]").replace(/password=[^;\s]*/gi, "password=[redacted]");
    throw new Error(
      `Prisma ${args[0] ?? "command"} failed:\n${redact(output.stdout ?? "")}\n${redact(output.stderr ?? "")}`,
    );
  }
}

/** `prisma migrate deploy`, as `infra/deploy.sh` runs it in production. */
export function migrate(url: string): string {
  return prismaCli(["migrate", "deploy", "--schema", SCHEMA], url);
}

/** Prisma 6 introspects native vectors without their dimensions. Verify the engine metadata
 * independently before removing its single known no-op ALTER from the drift check. */
export async function schemaDiff(url: string, db: PrismaClient): Promise<string> {
  const columns = await db.$queryRaw<{ vector_dimensions: number; is_nullable: boolean }[]>`
    SELECT vector_dimensions, is_nullable FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Food') AND name = 'embedding'`;
  if (columns.length !== 1 || columns[0]?.vector_dimensions !== 1024 || !columns[0].is_nullable)
    throw new Error("Food.embedding must be a nullable 1024-dimensional vector");
  return prismaCli(
    ["migrate", "diff", "--from-url", url, "--to-schema-datamodel", SCHEMA, "--script"],
    url,
  ).replace("ALTER TABLE [dbo].[Food] ALTER COLUMN [embedding] vector(1024) NULL;", "");
}
