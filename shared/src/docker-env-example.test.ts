import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * docker/.env.example is what `docker/init-secrets.sh` turns into docker/.env. Like the root
 * .env.example it holds only empty values, <placeholders>, localhost URLs and documented constants,
 * so the file can never hold a secret; and the compose file, the Dockerfiles and the ignore file
 * keep the promises the deployment guide makes.
 */
const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function entries(file: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of read(file).split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) result.set(match[1], match[2]);
  }
  return result;
}

function unquote(value: string): string {
  const trimmed = value.replace(/\s+#.*$/, "").trim();
  return /^"(.*)"$/.exec(trimmed)?.[1] ?? trimmed;
}

/** Values that are not secrets and are not <placeholders>, each with the reason. */
const DOCUMENTED_CONSTANTS: Record<string, string[]> = {
  BLOB_CONNECTION_STRING: [], // always carries the <generated-by-init-secrets> account key
  SECRETS_DIR: ["/credentials"], // the mount point of the credentials volume
  SOURCE_CONNECT_URL: ["http://poller/api/source-connect"], // the poller's name on the compose network
  FOOD_SOURCES: ["off,frida"], // plugin ids
  DEFAULT_LOCALE: ["da", "en"],
  OFF_COUNTRY: ["dk", "gb", "no", "se", "de"],
  FAKE_GLUCOSE_SOURCE: ["1"],
};

const REQUIRED = [
  "SQL_SA_PASSWORD",
  "DATABASE_URL",
  "AZURITE_ACCOUNT_KEY",
  "BLOB_CONNECTION_STRING",
  "BLOB_PUBLIC_ENDPOINT",
  "SECRETS_DIR",
  "BOOTSTRAP_TOKEN",
  "SOURCE_CONNECT_URL",
  "SOURCE_CONNECT_KEY",
  "APP_ORIGIN",
  "DEFAULT_LOCALE",
  "FOOD_SOURCES",
  "OFF_COUNTRY",
  "FAKE_GLUCOSE_SOURCE",
];

describe("docker/.env.example", () => {
  const documented = entries("docker/.env.example");

  it("names every setting the stack needs", () => {
    expect(REQUIRED.filter((name) => !documented.has(name))).toEqual([]);
  });

  it("holds only empty values, <placeholders>, localhost URLs and documented constants", () => {
    const offending = [...documented].filter(([name, raw]) => {
      const value = unquote(raw);
      if (value === "") return false;
      if (/<[^<>]+>/.test(value)) return false;
      if (/^https?:\/\/localhost(?::\d+)?(?:\/|$)/.test(value)) return false;
      return !(DOCUMENTED_CONSTANTS[name] ?? []).includes(value);
    });
    expect(offending.map(([name]) => name)).toEqual([]);
  });

  it("generates every secret: the three credentials and the keys are placeholders", () => {
    for (const name of [
      "SQL_SA_PASSWORD",
      "AZURITE_ACCOUNT_KEY",
      "BOOTSTRAP_TOKEN",
      "SOURCE_CONNECT_KEY",
    ])
      expect(unquote(documented.get(name) ?? ""), name).toBe("<generated-by-init-secrets>");
    expect(documented.get("DATABASE_URL")).toContain("password=<generated-by-init-secrets>");
    expect(documented.get("BLOB_CONNECTION_STRING")).toContain(
      "AccountKey=<generated-by-init-secrets>",
    );
  });

  it("unquotes values the way the value rule needs (self-test)", () => {
    expect(unquote('"<a>"')).toBe("<a>");
    expect(unquote("")).toBe("");
  });
});

describe("docker/compose.yaml", () => {
  const compose = read("docker/compose.yaml");
  const documented = entries("docker/.env.example");

  it("reads only settings docker/.env.example names", () => {
    const used = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)[:}?-]/g)].map((m) => m[1] ?? "");
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((name) => !documented.has(name))).toEqual([]);
  });

  it("holds no credential: no literal key, password or token", () => {
    expect(compose).not.toMatch(/AccountKey=(?!\$\{)/);
    expect(compose).not.toMatch(/password=(?!\$\{)/i);
  });

  it("starts the five services and neither Key Vault, Web PubSub nor Application Insights", () => {
    for (const service of ["sql", "azurite", "migrate", "web", "poller"])
      expect(compose, service).toMatch(new RegExp(`^  ${service}:`, "m"));
    expect(compose).toContain("mcr.microsoft.com/mssql/server:2025");
    expect(compose).not.toMatch(/KEY_VAULT_URL|WEB_PUBSUB|APPLICATIONINSIGHTS/);
    expect(compose).toContain("AzureWebJobsSecretStorageType: Files");
    expect(compose).toContain("AzureWebJobsSecretStoragePath: /azure-functions-host/Secrets");
    expect(compose).toContain("service_completed_successfully");
  });
});

describe("the images", () => {
  it("runs the web app as a non-root user from the standalone entry", () => {
    const web = read("docker/web.Dockerfile");
    expect(web).toMatch(/^FROM node:22-bookworm-slim/m);
    expect(web).toContain("pnpm --filter ./web build");
    expect(web).toMatch(/^USER node$/m);
    expect(web).toContain('CMD ["node", "web/server.js"]');
  });

  it("builds the poller bundle in a Node stage and runs it on the Functions image", () => {
    const poller = read("docker/poller.Dockerfile");
    expect(poller).toContain("pnpm --filter ./poller build");
    expect(poller).toContain("FROM mcr.microsoft.com/azure-functions/node:4-node22");
    expect(poller).toContain("/app/poller/dist /home/site/wwwroot");
  });

  it("migrates with the Prisma CLI and shared/prisma only", () => {
    const migrate = read("docker/migrate.Dockerfile");
    expect(migrate).toContain("prisma migrate deploy");
    expect(migrate).toContain("COPY shared/prisma");
    expect(migrate).toMatch(/^USER node$/m);
  });

  it("keeps secrets, history and local installs out of the build context", () => {
    const ignore = read(".dockerignore")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
    for (const pattern of [".git", "**/node_modules", "**/.env", "**/.env.*", "docker/.env"])
      expect(ignore, pattern).toContain(pattern);
  });
});

describe("docker/init-secrets.sh", () => {
  const script = read("docker/init-secrets.sh");

  it("writes the function keys in the shape the Functions host reads, mode 600, never into the repo", () => {
    expect(script).toContain('\\"keys\\":[{\\"name\\":\\"default\\"');
    expect(script).toContain("source-connect.json");
    expect(script).toContain("host.json");
    expect(script).toContain("chmod 600");
    expect(script).not.toMatch(/git (add|commit)/);
  });

  it("is ignored by git: docker/.env is covered by the .env.* rule, .env.example is not", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
    expect(existsSync(path.join(root, "docker/.env.example"))).toBe(true);
  });
});

describe("compose-check.yml", () => {
  const workflow = read(".github/workflows/compose-check.yml");

  it("runs on pull requests that touch docker/ or .dockerignore and is not a required check", () => {
    expect(workflow).toContain('"docker/**"');
    expect(workflow).toContain('".dockerignore"');
    expect(workflow).toMatch(/timeout-minutes: 15/);
    expect(workflow).toContain("/api/health");
    expect(workflow).toMatch(/\.env|\.git/);
  });
});
