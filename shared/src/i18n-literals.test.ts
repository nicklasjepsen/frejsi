import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ESLint, type Linter } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * "Nothing Danish is hard-coded" (spec section 9), made executable. Three things are checked:
 * the Danish-letters lint rule reaches shared/src and poller/src, no source file names
 * `Europe/Copenhagen`, and no source file writes a Danish default (`= "da"`, `?? "da"`, `|| "da"`,
 * `.default("da")`, a ternary that ends in `"da"`, and the same for `"dk"`) outside the places
 * where a Danish value is a documented setting or a list.
 */
const root = path.resolve(import.meta.dirname, "../..");
const SOURCE_DIRS = ["web/src", "poller/src", "shared/src"];

function walk(directory: string): string[] {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const isTest = (file: string) =>
  /\.test\.tsx?$/.test(file) || /(?:^|[/-])test-support\.tsx?$/.test(file);
const isCode = (file: string) => /\.(?:[cm]?tsx?|prisma)$/.test(file);
const sources = [...SOURCE_DIRS.flatMap(walk), ...walk("shared/prisma")]
  .filter((file) => isCode(file) && !isTest(file) && !file.includes("/migrations/"))
  .map((file) => ({ file, code: readFileSync(path.join(root, file), "utf8") }));

/**
 * The only Danish defaults, each behind a setting or a list (docs/architecture.md repeats this
 * list as "the only Danish defaults, each behind a setting").
 */
export const DANISH_DEFAULT_ALLOWED = [
  "shared/src/schemas/", // the Locale enum is a list, not a default
  "shared/prisma/", // User.locale @default("da"), kept by plan decision 17
  "web/src/lib/i18n/", // DEFAULT_LOCALE is read here and "da" is its documented fallback
  "shared/src/food/off/", // the OFF_COUNTRY fallback
];

// The `=` of `==`, `===`, `!=`, `<=` and `>=` is a comparison, not a default.
const DEFAULT_FORMS = [
  /(?<![=!<>])=\s*["'`](?:da|dk)["'`]/,
  /\?\?\s*["'`](?:da|dk)["'`]/,
  /\|\|\s*["'`](?:da|dk)["'`]/,
  /\bdefault\(\s*["'`](?:da|dk)["'`]\s*\)/,
  /\?[^?:\n]*:\s*["'`](?:da|dk)["'`]/,
];

function defaultsIn(code: string): string[] {
  return code
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .filter((line) => DEFAULT_FORMS.some((form) => form.test(line)));
}

describe("a Danish default is a setting, never a literal", () => {
  it("is found by every syntactic form the rule names", () => {
    for (const line of [
      'const locale = "da";',
      'const locale = value ?? "da";',
      'const locale = value || "dk";',
      'locale: z.string().default("da"),',
      'const locale = ok ? value : "da";',
    ]) {
      expect(defaultsIn(line), line).toHaveLength(1);
    }
    for (const line of [
      'if (locale === "da") return;',
      'const label = locale === "da" ? "Dansk" : "English";',
      'type Pair = { locale: "da" | "en" };',
      '// the fallback is ?? "da"',
    ]) {
      expect(defaultsIn(line), line).toHaveLength(0);
    }
  });

  it("holds in web/src, poller/src and shared/src outside the allowed places", () => {
    const found = sources
      .filter(({ file }) => !DANISH_DEFAULT_ALLOWED.some((allowed) => file.startsWith(allowed)))
      .flatMap(({ file, code }) => defaultsIn(code).map((line) => `${file}: ${line.trim()}`));
    expect(found).toEqual([]);
  });

  it("only lists places that exist", () => {
    for (const allowed of DANISH_DEFAULT_ALLOWED)
      expect(existsSync(path.join(root, allowed)), allowed).toBe(true);
  });

  it("is documented as the only Danish defaults in the architecture note", () => {
    const note = readFileSync(path.join(root, "docs/architecture.md"), "utf8");
    expect(note.toLowerCase()).toContain("the only danish defaults, each behind a setting");
    for (const allowed of DANISH_DEFAULT_ALLOWED) expect(note, allowed).toContain(allowed);
  });
});

describe("no time zone is hard-coded", () => {
  it("keeps Europe/Copenhagen out of web/src, poller/src and shared/src", () => {
    const found = sources
      .filter(({ code }) => code.includes("Europe/Copenhagen"))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });
});

describe("the Danish-letters lint rule", () => {
  async function messages(filePath: string, code: string): Promise<string[]> {
    const loaded = (await import(/* @vite-ignore */ path.join(root, "eslint.config.js"))) as {
      boundaries: Linter.Config[];
    };
    const { parser } = await import("typescript-eslint");
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        { files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser } },
        ...loaded.boundaries,
      ],
    });
    const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
    return (result?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
  }

  const danish = 'export const label = "Smør";\nexport const t = `Rød ${1}`;\n';

  it.each([
    "shared/src/glucose/probe.ts",
    "shared/src/food/probe.ts",
    "poller/src/functions/probe.ts",
  ])("fails a Danish string or template in %s", async (file) => {
    const found = await messages(file, danish);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("frejsi-english/danish-letters");
  });

  it.each([
    "shared/src/glucose/probe.test.ts",
    "shared/src/food/frida/data/probe.ts",
    "shared/src/food/search.ts",
    "shared/src/dosing-vocabulary.ts",
    "shared/src/ai/guard.ts",
    "shared/src/ai/estimate/prompt.ts",
    "shared/src/ai/insight/prompt-week.ts",
    "shared/src/ai/insight/meal.ts",
    "shared/src/ai/insight/week.ts",
    "shared/src/glucose/import/clarity.ts",
  ])("lets %s keep its Danish", async (file) => {
    expect(await messages(file, danish)).toEqual([]);
  });

  it("is named by the web rule too, so the three packages share one pattern", () => {
    const config = readFileSync(path.join(root, "eslint.config.js"), "utf8");
    expect(config).toContain('const DANISH_LETTERS = "[æøåÆØÅ]"');
    expect(config).toContain("frejsi/boundaries/english-in-shared-and-poller");
  });
});
