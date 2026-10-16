import path from "node:path";

import { ESLint, type Linter } from "eslint";
import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

it("keeps @prisma/adapter-mssql, mssql and tedious inside shared/src/db/", async () => {
  const { boundaries } = (await import(/* @vite-ignore */ path.join(root, "eslint.config.js"))) as {
    boundaries: Linter.Config[];
  };
  const { parser } = await import("typescript-eslint");
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{ files: ["**/*.ts"], languageOptions: { parser } }, ...boundaries],
  });
  const messages = async (file: string, code: string) =>
    (await eslint.lintText(code, { filePath: path.join(root, file) }))[0]?.messages.map(
      (m) => m.message,
    ) ?? [];
  for (const code of [
    'import { PrismaMssql } from "@prisma/adapter-mssql";',
    'import sql from "mssql";',
    'import type { config } from "mssql";',
    'const t = await import("tedious");',
    'import "mssql/lib/tedious";',
  ]) {
    for (const file of [
      "shared/src/glucose/poll-cycle.ts",
      "poller/src/functions/poll.ts",
      "web/src/lib/auth/session.ts",
    ]) {
      expect(await messages(file, code), `${file}: ${code}`).toContainEqual(
        expect.stringContaining("shared/src/db/"),
      );
    }
    expect(await messages("shared/src/db/client.ts", code)).toEqual([]);
  }
});
