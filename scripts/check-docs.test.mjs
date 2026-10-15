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
    "## Docs\n- [readme](README.md#what-it-does)",
    "## Docs\n- [operations](./docs/operations.md?plain=1#bootstrap-the-first-space)",
  ])("accepts documentation paths in the diff: %s", (body) => {
    expect(() => checkDocs(body, changed)).not.toThrow();
  });

  it.each([
    "## Docs\n- `CONTRIBUTING.md`",
    "## Docs\n- [contributing](CONTRIBUTING.md#workflow)",
    "## Docs\n- `README.md`\n- `docs/missing.md`",
    "## Docs\n- `web/src/example.ts`",
    "## Docs\n- `docs/design/tokens.json`",
    "## Docs\n- `docs/superpowers/plans/future.md`",
    "## Docs\n<!-- README.md -->",
    "```md\n## Docs\nREADME.md\n```",
    "## Docs\n```md\nREADME.md\n```",
  ])("rejects unchanged files, non-docs and quoted examples: %s", (body) => {
    expect(() =>
      checkDocs(body, [...changed, "docs/design/tokens.json", "docs/superpowers/plans/future.md"]),
    ).toThrow();
  });

  it.each([
    { files: [] },
    { files: ["web/src/example.ts"] },
    { files: ["docs/design/tokens.json", "docs/superpowers/plans/future.md"] },
  ])("accepts a reason when no counted docs changed: $files", ({ files }) =>
    expect(() =>
      checkDocs(
        "## Docs\nNone needed: Changes only test fixtures or historical design artifacts.",
        files,
      ),
    ).not.toThrow(),
  );

  it.each(["", "<reason>", "TODO", "n/a", "..."])("rejects a placeholder reason: %s", (reason) => {
    expect(() => checkDocs(`## Docs\nNone needed: ${reason}`, [])).toThrow(/real reason/);
  });

  it("exempts the Dependabot author, not other bots", () => {
    expect(() => checkDocs(null, [], "dependabot[bot]")).not.toThrow();
    expect(() => checkDocs(null, [], "another[bot]")).toThrow();
  });

  it("rejects None needed when counted documentation changed", () => {
    expect(() =>
      checkDocs(
        "## Docs\nNone needed: Internal-only refactor with no user-facing changes.",
        changed,
      ),
    ).toThrow(/documentation changed/);
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
  expect(
    run("## Docs\nNone needed: Internal-only refactor with no user-facing changes.").status,
  ).toBe(1);
  expect(run(null, "dependabot[bot]").status).toBe(0);
});
