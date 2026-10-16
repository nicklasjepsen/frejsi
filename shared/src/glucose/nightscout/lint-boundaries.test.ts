import path from "node:path";

import { ESLint, type Linter } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the Nightscout boundaries in eslint.config.js on probe files at the paths the rules
 * name, as the Dexcom ones are proven in shared/src/events/lint-boundaries.test.ts.
 */
const repoRoot = path.resolve(import.meta.dirname, "../../../..");
let eslint: ESLint;

beforeAll(async () => {
  const loaded = (await import(/* @vite-ignore */ path.join(repoRoot, "eslint.config.js"))) as {
    boundaries: Linter.Config[];
  };
  const { parser } = await import("typescript-eslint");
  eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser } },
      ...loaded.boundaries,
    ],
  });
});

async function messages(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) });
  return (result?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
}

// Assembled from pieces so this file does not trip the rules it tests.
const entriesPath = ["/api", "v1", "entries", "sgv.json"].join("/");
const verifyPath = ["/api/v1/", "verify", "auth"].join("");
const header = ["api", "secret"].join("-");

describe("the Nightscout boundaries", () => {
  it("keep the entries path, verifyauth and the auth header inside shared/src/glucose/nightscout", async () => {
    const probes = [
      `export const p = "${entriesPath}";\n`,
      `export const p = \`\${base}${verifyPath}\`;\n`,
      `export const h = { "${header}": "x" };\n`,
      `export const h = "API-SECRET";\n`,
    ];
    for (const code of probes) {
      for (const file of [
        "shared/src/glucose/poll-cycle.ts",
        "shared/src/glucose/dexcom-share/client.ts",
        "shared/src/events/emit.ts",
        "poller/src/sources.ts",
        "poller/src/functions/poll.ts",
        "web/src/app/api/spaces/x/route.ts",
        "web/src/lib/live/server.ts",
      ]) {
        const found = await messages(file, code);
        expect(found, `${file}: ${code}`).toEqual([
          expect.stringContaining(
            "Nightscout paths and auth header live in shared/src/glucose/nightscout/",
          ),
        ]);
      }
      expect(await messages("shared/src/glucose/nightscout/protocol.ts", code)).toEqual([]);
      expect(await messages("shared/src/glucose/nightscout/source.test.ts", code)).toEqual([]);
    }
  });

  it("keep fetch out of the Nightscout adapter; its transport is the one caller", async () => {
    const direct = 'export const f = (url: string) => fetch(url, { method: "POST" });\n';
    const member = "export class S { go(u: string) { return globalThis.fetch(u); } }\n";
    for (const code of [direct, member]) {
      const found = await messages("shared/src/glucose/nightscout/source.ts", code);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("read-only");
    }
    expect(await messages("shared/src/glucose/nightscout/transport.ts", member)).toEqual([]);
    expect(await messages("shared/src/glucose/nightscout/source.test.ts", direct)).toEqual([]);
  });

  it("keep globalThis.fetch out of the poller except where the adapters are wired", async () => {
    const code = "export const f = globalThis.fetch;\n";
    for (const file of [
      "poller/src/functions/poll.ts",
      "poller/src/cli.ts",
      "poller/src/poll-handler.ts",
    ]) {
      const found = await messages(file, code);
      expect(found, file).toHaveLength(1);
      expect(found[0]).toContain("poller/src/sources.ts or source-connect-handler.ts");
    }
    expect(await messages("poller/src/sources.ts", code)).toEqual([]);
    expect(await messages("poller/src/source-connect-handler.ts", code)).toEqual([]);
    expect(await messages("poller/src/sources.test.ts", code)).toEqual([]);
  });
});
