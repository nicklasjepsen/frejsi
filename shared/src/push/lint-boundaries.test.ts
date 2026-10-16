import path from "node:path";
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

it("allows the vendor import only in the push sink, including aliases and dynamic imports", async () => {
  for (const code of [
    'import push from "web-push";',
    'import {sendNotification as send} from "web-push";',
    'const push = await import("web-push");',
    'const push = require("web-push");',
  ]) {
    expect(await errors("shared/src/push/sink.ts", code)).toEqual([]);
    for (const file of [
      "web/src/app/api/spaces/x/route.ts",
      "shared/src/push/repository.ts",
      "poller/src/functions/poll.ts",
    ])
      expect(await errors(file, code)).toContainEqual(expect.stringContaining("WebPushSink"));
  }
});
