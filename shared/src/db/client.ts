import { PrismaMssql } from "@prisma/adapter-mssql";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { config as MssqlConfig } from "mssql";

/**
 * The database client (plan v0.5.0 §7).
 *
 * - `DATABASE_URL` set: today's engine-backed client (web, local development, tests, Docker).
 * - Otherwise `SQL_SERVER_FQDN` and `SQL_DATABASE` set: a client over `@prisma/adapter-mssql` that
 *   signs in with the Function App's managed identity (`azure-active-directory-default` acquires and
 *   refreshes the token through DefaultAzureCredential; `AZURE_CLIENT_ID` names the identity).
 * - Neither: an error that names both options.
 *
 * This is the only place the SQL Server driver adapter is imported (shared/src/db/lint-boundaries.test.ts).
 */
export type DbEnv = Readonly<Record<string, string | undefined>>;

export interface PrismaFactoryDeps {
  /** Builds the driver adapter from an mssql config. Injected in tests; no connection is opened. */
  createAdapter?: (config: MssqlConfig) => PrismaMssql;
  /** Builds the client. Injected in tests. */
  createClient?: (options: Prisma.PrismaClientOptions) => PrismaClient;
}

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

/** The mssql config for the managed-identity path, or undefined when the settings are absent. */
export function mssqlConfigFromEnv(env: DbEnv): MssqlConfig | undefined {
  const { SQL_SERVER_FQDN: server, SQL_DATABASE: database, AZURE_CLIENT_ID: clientId } = env;
  if (!present(server) || !present(database)) return undefined;
  return {
    server: server.trim(),
    database: database.trim(),
    authentication: {
      type: "azure-active-directory-default",
      options: present(clientId) ? { clientId: clientId.trim() } : {},
    },
    options: { encrypt: true, trustServerCertificate: false },
  };
}

export function createPrismaFromEnv(env: DbEnv, deps: PrismaFactoryDeps = {}): PrismaClient {
  const createAdapter = deps.createAdapter ?? ((config: MssqlConfig) => new PrismaMssql(config));
  const createClient =
    deps.createClient ?? ((options: Prisma.PrismaClientOptions) => new PrismaClient(options));
  const log: Prisma.LogLevel[] = env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];

  if (present(env.DATABASE_URL)) return createClient({ log });

  const config = mssqlConfigFromEnv(env);
  if (config) return createClient({ adapter: createAdapter(config), log });

  throw new Error(
    "No database configured: set DATABASE_URL, or SQL_SERVER_FQDN and SQL_DATABASE (with AZURE_CLIENT_ID for a managed identity).",
  );
}

const globalForPrisma = globalThis as unknown as { __frejsiPrisma?: PrismaClient };

function getClient(): PrismaClient {
  globalForPrisma.__frejsiPrisma ??= createPrismaFromEnv(process.env);
  return globalForPrisma.__frejsiPrisma;
}

/**
 * One client per process, constructed on first use: importing `@frejsi/shared` must not throw in a
 * process with no database setting (web's unit tests, `next build`). Next.js dev reloads modules;
 * keeping the instance on `globalThis` stops a connection per reload.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === "function" ? (value.bind(client) as unknown) : value;
  },
  has(_target, property) {
    return Reflect.has(getClient(), property);
  },
});

export type { PrismaClient } from "@prisma/client";
