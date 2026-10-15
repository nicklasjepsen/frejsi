import { readFileSync } from "node:fs";
import path from "node:path";

import { ApiErrorCode } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { LOCALES } from "./routing";

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

const read = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(messagesDir, `${locale}.json`), "utf8")) as Record<
    string,
    unknown
  >;

describe("web/messages", () => {
  it("has a file per locale and every key in da.json exists in en.json, and the other way", () => {
    expect(LOCALES).toEqual(["da", "en"]);
    const da = keysOf(read("da")).sort();
    const en = keysOf(read("en")).sort();
    expect(en).toEqual(da);
    expect(da.length).toBeGreaterThan(0);
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

  it("has no empty string in either file", () => {
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
