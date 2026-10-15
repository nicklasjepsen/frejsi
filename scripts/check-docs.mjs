import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOC_FILES = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "CLAUDE.md",
  "AGENTS.md",
  "infra/README.md",
  "poller/README.md",
  ".env.example",
]);

export function isDocFile(file) {
  if (file.split("/").some((part) => part === ".." || part === "." || part === "")) return false;
  return (
    DOC_FILES.has(file) ||
    (file.startsWith("docs/") &&
      !file.startsWith("docs/design/") &&
      !file.startsWith("docs/superpowers/plans/"))
  );
}

// Ignore template instructions and quoted examples; neither declares what this PR did.
function visibleMarkdown(body) {
  let fence;
  return body
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .split(/\r?\n/)
    .filter((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        return false;
      }
      if (marker) {
        fence = marker;
        return false;
      }
      return true;
    })
    .join("\n");
}

export function checkDocs(body, changedFiles, author) {
  if (author === "dependabot[bot]") return;
  const markdown = visibleMarkdown(body ?? "");
  const heading = /^## Docs[ \t]*#*[ \t]*$/m.exec(markdown);
  if (!heading) throw new Error("Add a ## Docs section to the PR body.");
  const section = markdown
    .slice(heading.index + heading[0].length)
    .split(/^#{1,2}\s/m)[0]
    .trim();
  if (!section)
    throw new Error(
      "The ## Docs section is empty. List changed docs or write None needed: <reason>.",
    );

  const none = /^None needed:[ \t]*([^\n]*)$/i.exec(section);
  if (none) {
    const reason = none[1].trim();
    if (
      reason.length >= 8 &&
      /\p{L}/u.test(reason) &&
      !/[<>]/.test(reason) &&
      !/^(?:todo|tbd|n\/?a|none|reason|not applicable|no docs?|no changes?|not needed)[.!]?$/i.test(
        reason,
      )
    )
      return;
    throw new Error(
      "The ## Docs section needs a real reason after None needed: (no placeholders).",
    );
  }

  // Paths may be plain, backticked or Markdown link targets, as shown in the PR template.
  const listed = section
    .split(/[\s`()[\]<>,;:"']+/u)
    .map((token) => token.replace(/^\.\//, "").replace(/\.$/, ""))
    .filter(isDocFile);
  if (!listed.length)
    throw new Error(
      "The ## Docs section must list documentation files (plans and design exports do not count).",
    );
  const changed = new Set(changedFiles);
  if (listed.some((file) => !changed.has(file))) {
    throw new Error(
      "The ## Docs section lists documentation that this PR does not change. Check the paths against the diff.",
    );
  }
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH must name a pull_request event file.");
  const { pull_request: pr } = JSON.parse(readFileSync(eventPath, "utf8"));
  if (!pr) throw new Error("Expected a pull_request event.");
  if (pr.user?.login === "dependabot[bot]") return;
  const base = pr.base?.sha;
  const head = pr.head?.sha;
  if (![base, head].every((sha) => typeof sha === "string" && /^[a-f0-9]{40,64}$/i.test(sha))) {
    throw new Error("The pull_request event must include its base and head commit SHAs.");
  }
  // Checkout is normally a synthetic merge commit. Only count changes on the PR's own branch.
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`, "--"],
    {
      encoding: "utf8",
      timeout: 5000,
    },
  )
    .split("\0")
    .filter(Boolean);
  checkDocs(pr.body, changed, pr.user?.login);
  console.log("PR docs declaration passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Docs check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
