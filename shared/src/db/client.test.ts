import type { PrismaMssql } from "@prisma/adapter-mssql";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createPrismaFromEnv, mssqlConfigFromEnv } from "./client";

/** Nothing here opens a connection: the adapter and the client are injected fakes. */
function deps() {
  const adapter = {
    provider: "sqlserver",
    marker: "adapter",
  } as unknown as PrismaMssql;
  const client = { marker: "client" };
  return {
    adapter,
    client,
    createAdapter: vi.fn(() => adapter),
    createClient: vi.fn(() => client as unknown as PrismaClient),
  };
}

describe("createPrismaFromEnv", () => {
  it("returns today's engine-backed client when DATABASE_URL is set", () => {
    const d = deps();
    const made = createPrismaFromEnv(
      {
        DATABASE_URL: "sqlserver://localhost:1433;database=frejsi;user=sa;password=x",
        NODE_ENV: "development",
      },
      d,
    );
    expect(made).toBe(d.client);
    expect(d.createAdapter).not.toHaveBeenCalled();
    expect(d.createClient).toHaveBeenCalledWith({ log: ["warn", "error"] });
  });

  it("prefers DATABASE_URL over the identity settings", () => {
    const d = deps();
    createPrismaFromEnv(
      { DATABASE_URL: "sqlserver://x", SQL_SERVER_FQDN: "s.example.invalid", SQL_DATABASE: "d" },
      d,
    );
    expect(d.createAdapter).not.toHaveBeenCalled();
  });

  it("builds an Entra-authenticated mssql config for the managed identity", () => {
    const d = deps();
    const made = createPrismaFromEnv(
      {
        SQL_SERVER_FQDN: "sql-fictional.database.windows.net",
        SQL_DATABASE: "frejsi",
        AZURE_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
      },
      d,
    );
    expect(made).toBe(d.client);
    expect(d.createAdapter).toHaveBeenCalledWith({
      server: "sql-fictional.database.windows.net",
      database: "frejsi",
      authentication: {
        type: "azure-active-directory-default",
        options: { clientId: "11111111-2222-3333-4444-555555555555" },
      },
      options: { encrypt: true, trustServerCertificate: false },
    });
    expect(d.createClient).toHaveBeenCalledWith({ adapter: d.adapter, log: ["error"] });
  });

  it("leaves the client id out when AZURE_CLIENT_ID is unset (DefaultAzureCredential decides)", () => {
    const config = mssqlConfigFromEnv({ SQL_SERVER_FQDN: "s", SQL_DATABASE: "d" });
    expect(config?.authentication).toEqual({
      type: "azure-active-directory-default",
      options: {},
    });
  });

  it("throws an error naming both options when neither is set", () => {
    expect(() => createPrismaFromEnv({}, deps())).toThrow(
      /DATABASE_URL.*SQL_SERVER_FQDN.*SQL_DATABASE/s,
    );
    expect(() => createPrismaFromEnv({ SQL_SERVER_FQDN: "s" }, deps())).toThrow(/SQL_DATABASE/);
  });
});

describe("the prisma singleton", () => {
  it("imports without a database setting and throws only on first use", async () => {
    const saved = { ...process.env };
    delete process.env.DATABASE_URL;
    delete process.env.SQL_SERVER_FQDN;
    delete process.env.SQL_DATABASE;
    delete (globalThis as { __frejsiPrisma?: unknown }).__frejsiPrisma;
    vi.resetModules();
    try {
      const mod = await import("./client");
      expect(mod.prisma).toBeDefined();
      expect(() => mod.prisma.user).toThrow(/DATABASE_URL/);
    } finally {
      process.env = saved;
    }
  });
});
