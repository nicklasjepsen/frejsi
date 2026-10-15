import path from "node:path";
import { readFileSync } from "node:fs";
import { ESLint, type Linter } from "eslint";
import { beforeAll, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
let eslint: ESLint;
beforeAll(async () => {
  const file = path.join(root, "eslint.config.js");
  const { boundaries } = (await import(/* @vite-ignore */ file)) as { boundaries: Linter.Config[] };
  const { parser } = await import("typescript-eslint");
  eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser } },
      ...boundaries,
    ],
  });
});
async function errors(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  return (result?.messages ?? []).map((message) => message.message);
}

it("keeps raw glucose and history out of both AI folders", async () => {
  for (const file of ["shared/src/ai/parse/service.ts", "web/src/ai/provider.ts"]) {
    for (const code of [
      'import { Reading as R } from "@frejsi/shared";',
      'import { readingsBetween } from "../history";',
      'import type { HistoryRepository } from "../history";',
      'import * as raw from "../../glucose/types";',
      'import { x } from "@frejsi/shared/insights/week-input";',
      'import { x } from "@/lib/history/repository";',
      "export const x = prisma.reading.findMany();",
      'export const x = prisma["reading"].findMany();',
    ])
      expect(await errors(file, code), code).toContainEqual(
        expect.stringContaining("Raw readings"),
      );
    expect(await errors(file, 'import type { InsightStats } from "@frejsi/shared";')).toEqual([]);
  }
});
it("keeps provider calls in services and the provider infrastructure", async () => {
  for (const method of ["complete", "vision", "embed"]) {
    const code = `provider.${method}({});`;
    expect(await errors("web/src/app/api/spaces/x/route.ts", code)).toContainEqual(
      expect.stringContaining("AI services"),
    );
    expect(await errors("shared/src/ai/parse/service.ts", code)).toEqual([]);
    expect(await errors("shared/src/ai/capped.ts", code)).toEqual([]);
    expect(await errors("shared/src/ai/tool-loop.ts", code)).toEqual([]);
    expect(await errors("shared/src/ai/azure-openai/provider.ts", code)).toEqual([]);
  }
  expect(await errors("shared/src/food/lookup.ts", "provider.embed({});")).toEqual([]);
  expect(await errors("shared/src/food/lookup.ts", "provider.complete({});")).toHaveLength(1);
  expect(await errors("poller/src/functions/enrich-foods.ts", "provider.embed({});")).toEqual([]);
  expect(
    await errors("poller/src/functions/weekly-insight.ts", "provider.complete({});"),
  ).toHaveLength(1);
});
it("limits fake and memory imports without changing existing fake rules", async () => {
  const imports = [
    'import { FakeAiProvider } from "@frejsi/shared/ai/fake";',
    'import { MemoryAiCallRepository as Calls } from "@frejsi/shared/ai/calls";',
    'import { MemoryInsightRepository } from "@frejsi/shared/insights/memory";',
    'import { MemoryPushSubscriptionRepository } from "@frejsi/shared/push/memory";',
  ];
  for (const code of imports) {
    expect(await errors("web/src/app/api/spaces/x/route.ts", code)).toContainEqual(
      expect.stringContaining("Fake and memory"),
    );
    for (const file of [
      "shared/src/ai/registry.ts",
      "shared/src/ai/capped.test.ts",
      "web/scripts/seed.ts",
      "poller/src/cli.ts",
      "evals/src/run.ts",
    ])
      expect(await errors(file, code)).toEqual([]);
  }
  expect(
    await errors(
      "web/src/app/api/spaces/x/route.ts",
      'import { MemoryEventSink } from "@frejsi/shared/events/memory";',
    ),
  ).toHaveLength(1);
});
it("allows registry calls only in the named factories, timers and evals", async () => {
  for (const code of [
    "aiProviders({});",
    'import { aiProviders as build } from "@frejsi/shared/ai"; build({});',
  ]) {
    for (const file of ["web/src/app/api/spaces/x/route.ts", "shared/src/ai/parse/service.ts"])
      expect(await errors(file, code)).toContainEqual(expect.stringContaining("registry callers"));
    for (const file of [
      "web/src/ai/provider.ts",
      "poller/src/functions/enrich-foods.ts",
      "poller/src/functions/weekly-insight.ts",
      "evals/src/run.ts",
      "shared/src/ai/capped.test.ts",
    ])
      expect(await errors(file, code)).toEqual([]);
  }
});
it("keeps AiCall writes in their repository", async () => {
  for (const method of [
    "create",
    "createMany",
    "upsert",
    "update",
    "updateMany",
    "delete",
    "deleteMany",
  ]) {
    const code = `prisma.aiCall.${method}({});`;
    expect(await errors("web/src/ai/provider.ts", code)).toContainEqual(
      expect.stringContaining("sole AiCall writer"),
    );
    expect(await errors("shared/src/ai/calls-prisma.ts", code)).toEqual([]);
  }
});
it("does not leak provider implementations through the public barrels", () => {
  const barrel = readFileSync(path.join(root, "shared/src/index.ts"), "utf8");
  expect(barrel).not.toMatch(/from ["']\.\/(ai|insights|push)(\/|["'])/);
  const ai = readFileSync(path.join(root, "shared/src/ai/index.ts"), "utf8");
  expect(ai).not.toMatch(/from ["']\.\/(fake|anthropic|voyage|azure-openai|ollama)(\/|["'])/);
  const pkg = JSON.parse(readFileSync(path.join(root, "shared/package.json"), "utf8")) as {
    exports: Record<string, string>;
  };
  expect(pkg.exports["./ai"]).toBe("./src/ai/index.ts");
});

it("closes namespace and aliased-constructor escapes from the AI boundaries", async () => {
  for (const code of [
    'import * as shared from "@frejsi/shared"; export type Raw = shared.Reading;',
    'import * as shared from "@frejsi/shared"; shared.readingsBetween();',
    'import * as history from "@/lib/history";',
  ])
    expect(await errors("web/src/ai/provider.ts", code)).toContainEqual(
      expect.stringContaining("Raw readings"),
    );
  expect(
    await errors(
      "web/src/app/api/spaces/x/route.ts",
      'import * as repository from "@frejsi/shared/ai/calls"; new repository.MemoryAiCallRepository();',
    ),
  ).toContainEqual(expect.stringContaining("Fake and memory"));
  for (const code of [
    'import { CappedAiProvider as Wrapped } from "@frejsi/shared/ai"; new Wrapped();',
    'import * as shared from "@frejsi/shared/ai"; new shared.CappedAiProvider();',
  ]) {
    expect(await errors("web/src/app/api/spaces/x/route.ts", code)).toContainEqual(
      expect.stringContaining("web provider factory"),
    );
    expect(await errors("web/src/ai/provider.ts", code)).toEqual([]);
  }
  const direct =
    'import { AnthropicProvider as Direct } from "../anthropic/provider"; new Direct();';
  expect(await errors("shared/src/ai/parse/service.ts", direct)).toContainEqual(
    expect.stringContaining("registry only"),
  );
  expect(await errors("shared/src/ai/registry.ts", direct)).toEqual([]);
});
