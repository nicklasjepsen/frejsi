import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkDocs, isDocFile } from "./check-docs.mjs";

const changed = ["README.md", "docs/operations.md", "web/src/example.ts"];

describe("PR docs declaration", () => {
  it.each([
    null,
    "",
    "## Tests\nPassed",
    "## Docs\n\n## Tests\nREADME.md",
    "## Docs\n<!-- list files -->",
  ])("rejects a missing or empty section: %s", (body) =>
    expect(() => checkDocs(body, changed)).toThrow(/Docs/),
  );

  it.each([
    "## Docs\n- `README.md`\n- [operations](docs/operations.md)",
    "## Docs\r\nREADME.md\r\n### Details\r\nRefreshed the status.\r\n## Tests\r\nPassed",
    "## Docs\nNone needed: Changes only a unit-test fixture; public behavior is unchanged.",
  ])("accepts changed docs or a reason: %s", (body) => {
    expect(() => checkDocs(body, changed)).not.toThrow();
  });

  it.each([
    "## Docs\n- `CONTRIBUTING.md`",
    "## Docs\n- `README.md`\n- `docs/missing.md`",
    "## Docs\n- `web/src/example.ts`",
    "## Docs\n- `docs/design/tokens.json`",
    "## Docs\n- `docs/superpowers/plans/future.md`",
    "## Docs\n<!-- README.md -->",
    "```md\n## Docs\nREADME.md\n```",
    "## Docs\n```md\nREADME.md\n```",
    "## Docs\nNone needed:",
    "## Docs\nNone needed: <reason>",
    "## Docs\nNone needed: TODO",
    "## Docs\nNone needed: n/a",
    "## Docs\nNone needed: ...",
  ])("rejects unchanged files, non-docs and placeholders: %s", (body) => {
    expect(() =>
      checkDocs(body, [...changed, "docs/design/tokens.json", "docs/superpowers/plans/future.md"]),
    ).toThrow();
  });

  it("exempts the Dependabot author, not other bots", () => {
    expect(() => checkDocs(null, [], "dependabot[bot]")).not.toThrow();
    expect(() => checkDocs(null, [], "another[bot]")).toThrow();
  });

  it.each([
    "README.md",
    "CONTRIBUTING.md",
    "CLAUDE.md",
    "AGENTS.md",
    "docs/operations.md",
    "docs/nested/guide.md",
    "infra/README.md",
    "poller/README.md",
    ".env.example",
  ])("counts %s as documentation", (file) => expect(isDocFile(file)).toBe(true));

  it.each([
    "docs/design/artboards/canvas.json",
    "docs/superpowers/plans/future.md",
    "web/README.md",
    ".claude/skills/land/SKILL.md",
    "docs-other/file.md",
    "../README.md",
  ])("does not count %s", (file) => expect(isDocFile(file)).toBe(false));
});

const temporary = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("reads the event and diffs the PR head against its merge base, not the checkout's merge commit", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "frejsi-docs-"));
  temporary.push(dir);
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.name", "Fictional Contributor");
  git("config", "user.email", "contributor@example.invalid");
  writeFileSync(path.join(dir, "README.md"), "Original\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  git("checkout", "-qb", "lane");
  writeFileSync(path.join(dir, "code.js"), "export const example = true;\n");
  git("add", ".");
  git("commit", "-qm", "code only");
  let head = git("rev-parse", "HEAD");
  git("checkout", "-q", "main");
  writeFileSync(path.join(dir, "README.md"), "Changed on base only\n");
  git("commit", "-qam", "base docs");
  const base = git("rev-parse", "HEAD");
  git("merge", "-q", "--no-ff", "lane", "-m", "synthetic checkout");
  const eventPath = path.join(dir, "event.json");
  const run = (body, author = "fictional-contributor") => {
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          body,
          user: { login: author },
          base: { sha: base },
          head: { sha: head },
        },
      }),
    );
    return spawnSync(process.execPath, [path.join(import.meta.dirname, "check-docs.mjs")], {
      cwd: dir,
      env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
      encoding: "utf8",
    });
  };
  expect(run("## Docs\n- `README.md`").status).toBe(1);
  expect(run("## Docs\nNone needed: Changes an internal example used only by tests.").status).toBe(
    0,
  );
  git("checkout", "-q", "lane");
  writeFileSync(path.join(dir, "README.md"), "Changed in PR\n");
  git("add", "README.md");
  git("commit", "-qm", "lane docs");
  head = git("rev-parse", "HEAD");
  expect(run("## Docs\n- `README.md`").status).toBe(0);
  expect(run(null, "dependabot[bot]").status).toBe(0);
});
