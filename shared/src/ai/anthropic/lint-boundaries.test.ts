import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { ESLint, type Linter } from "eslint";
import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
it("enforces vendor SDK, hosts and model identifiers at the adapter boundary", async () => {
  const { boundaries } = (await import(/* @vite-ignore */ path.join(root, "eslint.config.js"))) as {
    boundaries: Linter.Config[];
  };
  const { parser } = await import("typescript-eslint");
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{ files: ["**/*.ts"], languageOptions: { parser } }, ...boundaries],
  });
  for (const [code, folder] of [
    ['import SDK from "@anthropic-ai/sdk";', "anthropic"],
    ['const host = "https://api.voyageai.com/v1/embeddings";', "voyage"],
    ["const host = `https://fictional.openai.azure.com`;", "azure-openai"],
    ['const host = "http://localhost:11434/api/chat";', "ollama"],
    ['const model = "claude-sonnet-5-5";', "anthropic"],
    ['const model = "voyage-3.5";', "voyage"],
    ['const model = "text-embedding-3-small";', "azure-openai"],
    ['const model = "mxbai-embed-large";', "ollama"],
  ]) {
    const bad = await eslint.lintText(code ?? "", {
      filePath: path.join(root, "shared/src/ai/parse/service.ts"),
    });
    expect(
      bad[0]?.messages.map((message) => message.message),
      code,
    ).toContainEqual(expect.stringContaining("Vendor"));
    const good = await eslint.lintText(code ?? "", {
      filePath: path.join(root, `shared/src/ai/${folder ?? ""}/provider.ts`),
    });
    expect(good[0]?.messages, code).toEqual([]);
  }
});
it("has no model identifiers outside adapter implementation folders", () => {
  for (const base of ["shared/src", "web/src", "poller/src"]) {
    for (const entry of readdirSync(path.join(root, base), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name))
        continue;
      const file = path.join(entry.parentPath, entry.name);
      if (/\/shared\/src\/ai\/(anthropic|voyage|azure-openai|ollama)\//.test(file)) continue;
      expect(readFileSync(file, "utf8"), path.relative(root, file)).not.toMatch(
        /claude-|voyage-|text-embedding|mxbai/,
      );
    }
  }
});
