import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

function walk(directory: string): string[] {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : [file];
  });
}

describe("the Docker Compose branch lives in shared/src/secrets/ and nowhere else", () => {
  const files = ["web/src", "poller/src"].flatMap(walk).filter((file) => /\.[cm]?tsx?$/.test(file));

  it("finds the trees it guards", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("web/src and poller/src contain no SECRETS_DIR, BLOB_PUBLIC_ENDPOINT or compose branch", () => {
    const offending = files.filter((file) => {
      if (file.endsWith("/env-example.test.ts")) return false;
      const code = readFileSync(path.join(root, file), "utf8");
      return /SECRETS_DIR|BLOB_PUBLIC_ENDPOINT|FileSecrets|docker[- ]?compose|\bcompose\b/i.test(
        code,
      );
    });
    expect(offending).toEqual([]);
  });
});
