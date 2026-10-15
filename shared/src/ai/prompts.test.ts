import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { assertNoDosing } from "./guard";

function prompts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory()
        ? prompts(file)
        : /^prompt.*\.ts$/.test(entry.name) && !entry.name.endsWith(".test.ts")
          ? [file]
          : [];
    })
    .sort();
}
function check(dir: string): string[] {
  const files = prompts(dir);
  for (const file of files) assertNoDosing(readFileSync(file, "utf8"), file);
  return files;
}
it("guards every prompt file under AI, including nested service folders", () => {
  const dir = import.meta.dirname;
  const listing = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => /^prompt.*\.ts$/.test(path.basename(file)) && !file.endsWith(".test.ts"))
    .map((file) => path.join(dir, file))
    .sort();
  expect(check(dir)).toEqual(listing);
  // The foundation has no service prompts yet. Prove the scanner independently so this cannot
  // silently become an empty glob when the following lanes add their prompts.
  const temp = mkdtempSync(path.join(tmpdir(), "frejsi-prompts-"));
  try {
    mkdirSync(path.join(temp, "meal"));
    const file = path.join(temp, "meal", "prompt-week.ts");
    writeFileSync(file, 'export const prompt = "Describe the meal.";');
    expect(check(temp)).toEqual([file]);
    writeFileSync(file, 'export const prompt = "ratio";');
    expect(() => check(temp)).toThrow(expect.objectContaining({ code: "ai-rejected" }));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
