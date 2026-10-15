import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ApiErrorCode } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { getMessages } from "./messages";
import { LOCALES } from "./routing";

// One file per top-level namespace and locale: web/messages/<locale>/<namespace>.json.
const messagesDir = path.resolve(import.meta.dirname, "../../../messages");

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      keysOf(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  throw new Error(`Unexpected value at ${prefix}`);
}

const namespaces = (locale: string): string[] =>
  readdirSync(path.join(messagesDir, locale))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();

const readNamespace = (locale: string, namespace: string): unknown =>
  JSON.parse(readFileSync(path.join(messagesDir, locale, `${namespace}.json`), "utf8")) as unknown;

/** The whole tree for a locale, read straight from its namespace files. */
const read = (locale: string): Record<string, unknown> =>
  Object.fromEntries(namespaces(locale).map((ns) => [ns, readNamespace(locale, ns)]));

describe("web/messages", () => {
  it("has a folder per locale and every namespace file exists in both", () => {
    expect(LOCALES).toEqual(["da", "en"]);
    expect(namespaces("da").length).toBeGreaterThan(0);
    expect(namespaces("en")).toEqual(namespaces("da"));
  });

  it("every key in da exists in en, and the other way", () => {
    const da = keysOf(read("da")).sort();
    const en = keysOf(read("en")).sort();
    expect(en).toEqual(da);
    expect(da.length).toBeGreaterThan(0);
  });

  it.each(LOCALES)("%s: getMessages assembles exactly the namespace files", (locale) => {
    const messages = getMessages(locale) as Record<string, unknown>;
    expect(Object.keys(messages).sort()).toEqual(namespaces(locale));
    for (const ns of namespaces(locale)) {
      expect(messages[ns], `${locale}/${ns}.json`).toEqual(readNamespace(locale, ns));
    }
  });

  it.each(LOCALES)("%s carries a message per ApiError code (plan §9)", (locale) => {
    const api = (read(locale).errors as { api: Record<string, string> }).api;
    for (const code of ApiErrorCode.options) {
      expect(api[code], code).toMatch(/\S/);
    }
    expect(Object.keys(api).sort()).toEqual([...ApiErrorCode.options].sort());
  });

  it.each(LOCALES)("%s names every glucose source type by its key (plan §9)", (locale) => {
    const source = read(locale).source as Record<string, { name: string }>;
    expect(source["dexcom-share"]?.name).toBe("Dexcom Share");
  });

  it("has no empty string in either locale", () => {
    for (const locale of LOCALES) {
      const walk = (value: unknown, where: string) => {
        if (typeof value === "string") expect(value.trim(), where).not.toBe("");
        else if (typeof value === "object" && value !== null) {
          for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`);
        }
      };
      walk(read(locale), locale);
    }
  });
});
