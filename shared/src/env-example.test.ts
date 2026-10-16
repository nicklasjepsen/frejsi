import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `.env.example` is the list of every setting the code reads: a variable read in web/src,
 * poller/src or shared/src but missing from it fails, and so does a variable in it that nothing
 * reads. Values are empty, a `<placeholder>`, a localhost URL or a documented constant, so the file
 * can never hold a secret (gitleaks stays the guard for everything else).
 */
const root = path.resolve(import.meta.dirname, "../..");

function walk(directory: string): string[] {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : [file];
  });
}

/** The runtime's own names: set by Node, Next.js, the Functions host or Azure, never by us. */
const RUNTIME_OWN = [
  /^NODE_ENV$/,
  /^NEXT_RUNTIME$/,
  /^CI$/,
  /^PATH$/,
  /^FUNCTIONS_/,
  /^IDENTITY_/,
  /^AzureWebJobs/,
  /^WEBSITE_/,
];
const isRuntimeOwn = (name: string) => RUNTIME_OWN.some((pattern) => pattern.test(name));

/** `process.env.X`, `env.X` and `env["X"]` in code, and `env("X")` in the Prisma schema files. */
const READS = [
  /\b(?:process\.env|env)\.([A-Za-z][A-Za-z0-9_]*)\b/g,
  /\b(?:process\.env|env)\[\s*["'`]([A-Za-z][A-Za-z0-9_]*)["'`]\s*\]/g,
  /\benv\(\s*"([A-Za-z][A-Za-z0-9_]*)"\s*\)/g,
];
const isTest = (file: string) =>
  /\.test\.tsx?$/.test(file) || /(?:^|[/-])test-support\.tsx?$/.test(file);

function namesRead(): Map<string, string> {
  const found = new Map<string, string>();
  const files = [
    ...["web/src", "poller/src", "shared/src"].flatMap(walk),
    ...walk("shared/prisma").filter((file) => file.endsWith(".prisma")),
  ].filter((file) => /\.(?:[cm]?tsx?|prisma)$/.test(file) && !isTest(file));
  for (const file of files) {
    const code = readFileSync(path.join(root, file), "utf8");
    for (const read of READS)
      for (const match of code.matchAll(read)) {
        const name = match[1];
        // Settings are written in capitals; a lower-case property of a local `env` is not one.
        if (name && (name === name.toUpperCase() || name.startsWith("AzureWebJobs")))
          found.set(name, found.get(name) ?? file);
      }
  }
  return found;
}

function entries(): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of readFileSync(path.join(root, ".env.example"), "utf8").split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) result.set(match[1], match[2]);
  }
  return result;
}

/** Constants the file may carry, each with the reason it is not a secret. */
const DOCUMENTED_CONSTANTS: Record<string, string[]> = {
  WEB_PUBSUB_HUB: ["frejsi"], // the hub's name, fixed in infra/modules/webpubsub.bicep
  NEXT_PUBLIC_APP_VERSION: ["dev"],
  APP_VERSION: ["dev"],
  FAKE_GLUCOSE_SOURCE: ["1"],
  FAKE_AI_PROVIDER: ["1"],
  FAKE_FOOD_CONTRIBUTOR: ["1"],
  AI_DAILY_CAP: ["50"], // the defaults documented in docs/architecture.md
  AI_EMBED_DAILY_CAP: ["500"],
  AI_EMBED_BACKFILL_DAILY_CAP: ["2000"],
  FOOD_SOURCES: ["off,frida"], // plugin ids, not credentials
  DEFAULT_LOCALE: ["da", "en"],
  OFF_COUNTRY: ["dk", "gb", "no", "se", "de"], // ISO country codes of a plugin's market
  OFF_LANGUAGE: ["da", "en"],
  AZURE_CLIENT_ID: [], // a GUID is a placeholder or empty here
};

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^"(.*)"$/.exec(trimmed) ?? /^'(.*)'$/.exec(trimmed);
  return quoted?.[1] ?? trimmed;
}

describe(".env.example", () => {
  const read = namesRead();
  const documented = entries();

  it("finds the settings the code reads (the scan itself works)", () => {
    for (const name of [
      "APP_ORIGIN",
      "KEY_VAULT_URL",
      "FOOD_SOURCES",
      "AI_DAILY_CAP",
      "DATABASE_URL",
    ])
      expect(read.has(name), name).toBe(true);
    expect(read.has("NODE_ENV")).toBe(true);
  });

  it("names every variable read in web/src, poller/src and shared/src", () => {
    const missing = [...read]
      .filter(([name]) => !isRuntimeOwn(name) && !documented.has(name))
      .map(([name, file]) => `${name} (read in ${file})`);
    expect(missing).toEqual([]);
  });

  it("names nothing that no code reads", () => {
    const unused = [...documented.keys()].filter((name) => !read.has(name) && !isRuntimeOwn(name));
    expect(unused).toEqual([]);
  });

  it("holds only empty values, <placeholders>, localhost URLs and documented constants", () => {
    const offending = [...documented].filter(([name, raw]) => {
      const value = unquote(raw.replace(/\s+#.*$/, ""));
      if (value === "") return false;
      if (/<[^<>]+>/.test(value)) return false;
      if (/^https?:\/\/localhost(?::\d+)?(?:\/|$)/.test(value)) return false;
      if (/^sqlserver:\/\/localhost[:;]/.test(value) && /<[^<>]+>/.test(value)) return false;
      return !(DOCUMENTED_CONSTANTS[name] ?? []).includes(value);
    });
    expect(offending.map(([name]) => name)).toEqual([]);
  });

  it("is not fooled by the checks above (self-test of the value rule)", () => {
    expect(unquote('"<a-placeholder>"')).toBe("<a-placeholder>");
    expect(unquote("")).toBe("");
  });
});
