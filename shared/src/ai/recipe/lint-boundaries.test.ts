import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
let eslint: ESLint;
beforeAll(async () => {
  const file = path.join(root, "eslint.config.js");
  const { boundaries } = (await import(/* @vite-ignore */ file)) as { boundaries: Linter.Config[] };
  const { parser } = await import("typescript-eslint");
  eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser } }, ...boundaries],
  });
});
async function errors(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  return (result?.messages ?? []).map((message) => message.message);
}

/** Every source file under a folder, tests left out. */
function sources(dir: string): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(file);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
    })
    .sort();
}
const relative = (file: string) => path.relative(root, file).replaceAll("\\", "/");
const read = (file: string) => readFileSync(file, "utf8");

describe("the recipe boundaries (plan task 4 hard rules)", () => {
  it("lets the recipe service call the provider, and keeps the web side on aiForSpace", async () => {
    for (const method of ["complete", "vision"]) {
      expect(await errors("shared/src/ai/recipe/parse.ts", `provider.${method}({});`)).toEqual([]);
      expect(await errors("web/src/ai/recipe/service.ts", `provider.${method}({});`)).toContainEqual(
        expect.stringContaining("AI services"),
      );
      expect(await errors("web/src/lib/recipes/service.ts", `provider.${method}({});`)).toContainEqual(
        expect.stringContaining("AI services"),
      );
    }
    expect(await errors("web/src/ai/recipe/service.ts", "aiProviders({});")).toContainEqual(
      expect.stringContaining("registry callers"),
    );
    expect(
      await errors(
        "web/src/lib/recipes/service.ts",
        'import { CappedAiProvider } from "@frejsi/shared/ai"; new CappedAiProvider();',
      ),
    ).toContainEqual(expect.stringContaining("web provider factory"));
  });

  it("fetches a recipe page only in shared/src/ai/recipe/page.ts, called only from web/src/lib/recipes/", () => {
    const recipeFiles = sources(path.join(root, "shared/src/ai/recipe"));
    expect(recipeFiles.length).toBeGreaterThan(3);
    for (const file of recipeFiles) {
      const calls = /(?<![\w.])fetch\s*\(/.test(read(file));
      expect(calls, relative(file)).toBe(relative(file) === "shared/src/ai/recipe/page.ts");
    }
    const everything = [
      ...sources(path.join(root, "shared/src")),
      ...sources(path.join(root, "web/src")),
      ...sources(path.join(root, "poller/src")),
    ];
    const callers = everything
      .filter((file) => /fetchRecipePage|ai\/recipe\/page["']/.test(read(file)))
      .map(relative);
    expect(callers).toContain("shared/src/ai/recipe/page.ts");
    for (const caller of callers)
      expect(
        caller === "shared/src/ai/recipe/page.ts" || caller.startsWith("web/src/lib/recipes/"),
        caller,
      ).toBe(true);
    expect(callers.some((caller) => caller.startsWith("web/src/lib/recipes/"))).toBe(true);
  });

  it("gives the web recipe code its provider from aiForSpace and nothing else", () => {
    const web = [
      ...sources(path.join(root, "web/src/ai/recipe")),
      ...sources(path.join(root, "web/src/lib/recipes")),
      ...sources(path.join(root, "web/src/app/api/spaces/[spaceId]/recipes")),
      ...sources(path.join(root, "web/src/app/api/share")),
      ...sources(path.join(root, "web/src/components/recipes")),
    ].map((file) => [relative(file), read(file)] as const);
    expect(web.length).toBeGreaterThan(5);
    const providerUsers = web.filter(([, code]) => /provider/i.test(code) && /parseRecipe/.test(code));
    expect(providerUsers.map(([file]) => file)).toEqual(["web/src/ai/recipe/service.ts"]);
    for (const [file, code] of web) {
      expect(code, file).not.toMatch(/aiProviders\(|CappedAiProvider|FakeAiProvider|MemoryAiCallRepository/);
      expect(code, file).not.toMatch(/prisma\.(reading|event)\./);
    }
    const service = web.find(([file]) => file === "web/src/ai/recipe/service.ts")?.[1] ?? "";
    expect(service).toMatch(/import \{[^}]*\baiForSpace\b[^}]*\} from "@\/ai\/provider"/);
    expect(service.match(/\baiForSpace\b/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
