import path from "node:path";

import { ESLint, type Linter } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the package boundaries in eslint.config.js (plan §2) on probe files at the paths the
 * rules name. Only the syntactic boundary rules run, so no type information is needed.
 */
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const configPath = path.join(repoRoot, "eslint.config.js");

let eslint: ESLint;
let defaultConfig: Linter.Config[];
let boundaries: Linter.Config[];

beforeAll(async () => {
  // A variable path keeps TypeScript from typing the untyped JS config module.
  const loaded = (await import(/* @vite-ignore */ configPath)) as {
    default: Linter.Config[];
    boundaries: Linter.Config[];
  };
  defaultConfig = loaded.default;
  boundaries = loaded.boundaries;
  eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: await tsParser() } },
      ...boundaries,
    ],
  });
});

async function tsParser(): Promise<Linter.Parser> {
  const { parser } = await import("typescript-eslint");
  return parser;
}

async function messages(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) });
  return (result?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
}

describe("lint boundaries", () => {
  it("are part of the default config every package lints with", () => {
    for (const block of boundaries) expect(defaultConfig).toContain(block);
  });

  it("fail prisma.event.create outside emit.ts and allow it inside", async () => {
    const code =
      'import { prisma } from "@frejsi/shared";\nexport const f = () => prisma.event.create({ data: {} });\n';
    expect(await messages("web/src/app/api/spaces/x/route.ts", code)).toEqual([
      expect.stringContaining("emit() in shared/src/events/emit.ts is the only writer of Event"),
    ]);
    expect(
      await messages(
        "poller/src/functions/poll.ts",
        "export const f = (tx: any) => tx.event.createMany({});\n",
      ),
    ).toHaveLength(1);
    expect(
      await messages(
        "shared/src/events/emit.ts",
        "export const f = (tx: any) => tx.event.create({});\n",
      ),
    ).toEqual([]);
  });

  it("fail @azure/web-pubsub outside shared/src/events and @azure/keyvault-secrets outside shared/src/secrets", async () => {
    const pubsub =
      'import { WebPubSubServiceClient } from "@azure/web-pubsub";\nexport const c = WebPubSubServiceClient;\n';
    const keyvault =
      'import { SecretClient } from "@azure/keyvault-secrets";\nexport const c = SecretClient;\n';
    expect(await messages("web/src/lib/live/negotiate.ts", pubsub)).toEqual([
      expect.stringContaining("Only shared/src/events/ talks to Web PubSub"),
    ]);
    expect(await messages("shared/src/events/pubsub.ts", pubsub)).toEqual([]);
    expect(await messages("shared/src/events/pubsub.ts", keyvault)).toHaveLength(1);
    expect(await messages("poller/src/functions/source-connect.ts", keyvault)).toEqual([
      expect.stringContaining("Only shared/src/secrets/ talks to Key Vault"),
    ]);
    expect(await messages("shared/src/secrets/keyvault.ts", keyvault)).toEqual([]);
    expect(await messages("shared/src/secrets/keyvault.ts", pubsub)).toHaveLength(1);
    expect(await messages("shared/src/glucose/poll-cycle.ts", pubsub)).toHaveLength(1);
  });

  it("let only tests, the seed and the CLI import the fakes", async () => {
    const fake =
      'import { FakeGlucoseSource } from "@frejsi/shared/glucose/fake";\nexport const s = FakeGlucoseSource;\n';
    const memory =
      'import { MemoryEventSink } from "../events/memory";\nexport const s = MemoryEventSink;\n';
    const secrets =
      'import { MemorySecrets } from "@frejsi/shared/secrets/memory";\nexport const s = MemorySecrets;\n';
    expect(await messages("poller/src/functions/poll.ts", fake)).toEqual([
      expect.stringContaining("tests, the seed and the CLI only"),
    ]);
    expect(await messages("shared/src/glucose/poll-cycle.ts", memory)).toHaveLength(1);
    expect(await messages("web/src/app/api/health/route.ts", secrets)).toHaveLength(1);
    expect(await messages("poller/src/cli.ts", fake)).toEqual([]);
    expect(await messages("web/scripts/seed.ts", fake)).toEqual([]);
    expect(await messages("shared/src/glucose/poll-cycle.test.ts", memory)).toEqual([]);
    expect(await messages("web/src/lib/auth/session.test.ts", secrets)).toEqual([]);
  });

  it("keep web and poller on @frejsi/shared, not relative paths into shared/src", async () => {
    const relative =
      'import { emit } from "../../../shared/src/events/emit";\nexport const e = emit;\n';
    expect(await messages("web/src/lib/live/feed.ts", relative)).toEqual([
      expect.stringContaining("Import domain code from @frejsi/shared"),
    ]);
    expect(
      await messages(
        "web/src/lib/live/feed.ts",
        'import { emit } from "@frejsi/shared";\nexport const e = emit;\n',
      ),
    ).toEqual([]);
  });

  it("keep the Dexcom host inside shared/src/glucose/dexcom-share", async () => {
    // Assembled from pieces so this test file does not trip the rule it tests.
    const hostName = ["shareous1", "dexcom", "com"].join(".");
    const servicePath = ["ShareWeb", "Services"].join("");
    const host = `export const base = "https://${hostName}/${servicePath}/Services";\n`;
    expect(await messages("shared/src/glucose/poll-cycle.ts", host)).toHaveLength(1);
    expect(await messages("shared/src/glucose/dexcom-share/client.ts", host)).toEqual([]);
  });

  it("keep Danish out of web/src code; web/messages/da/ is where it lives", async () => {
    const danish =
      'export const title = "Blodsukker vises ikke her";\nexport const t = `Måltid`;\n';
    const found = await messages("web/src/components/shell/Viewer.tsx", danish);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("web/messages/da/<namespace>.json");
    expect(await messages("web/src/components/shell/Viewer.test.tsx", danish)).toEqual([]);
    expect(
      await messages("web/src/components/shell/Viewer.tsx", 'export const title = "Glucose";\n'),
    ).toEqual([]);
  });
});
