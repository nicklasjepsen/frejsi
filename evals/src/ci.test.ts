import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("keeps eval CI gated by exactly the prompt/eval paths and maps the dedicated secret", () => {
  const ci = readFileSync(
    path.resolve(import.meta.dirname, "../../.github/workflows/ci.yml"),
    "utf8",
  );
  const step = ci.slice(ci.indexOf("      - name: AI evals"));
  expect(step).toContain("if: steps.changes.outputs.evals == 'true'");
  expect(step).toContain("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY_EVALS }}");
  expect(step).toContain("run: pnpm --filter ./evals test");
  const match = /if echo "\$CHANGED" \| grep -Eq '([^']+)'; then\n\s+echo "evals=true"/.exec(ci);
  expect(match).not.toBeNull();
  const pattern = match?.[1] ?? "";
  // Exercise the workflow's actual grep expression rather than a separately copied matcher.
  const selected = (file: string) => {
    try {
      execFileSync("grep", ["-Eq", pattern], { input: `${file}\n` });
      return true;
    } catch {
      return false;
    }
  };
  for (const file of [
    "evals/src/harness.ts",
    "web/src/ai/parse/service.ts",
    "shared/src/ai/insight/prompt-week.ts",
  ])
    expect(selected(file)).toBe(true);
  for (const file of [
    "web/src/components/example.tsx",
    "shared/src/stats/meal.ts",
    "poller/src/index.ts",
    "docs/operations.md",
    "other/evals/a.ts",
  ])
    expect(selected(file)).toBe(false);
});
