import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The documents are part of the product (spec section 9), so they are held to the code:
 * - the walkthrough names the repository variables, secrets, environments and settings the
 *   workflows, the Bicep parameters and the deploy script really read, and all of them;
 * - the architecture note names the configuration the code reads;
 * - every repository path the three documents cite exists;
 * - the contributor documents keep their promises (the plugin guides, the DCO, the dosing boundary);
 * - no document written for forks carries the owner's own domain or address.
 */
const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const WALKTHROUGH = "docs/deploy-your-own.md";
const ARCHITECTURE = "docs/architecture.md";
const GUIDES = ["docs/plugins/food-source.md", "docs/plugins/glucose-source.md"];
const WORKFLOWS = [
  ".github/workflows/release.yml",
  ".github/workflows/preview.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/housekeeping.yml",
];
const SOURCES = [...WORKFLOWS, "infra/main.bicepparam", "infra/deploy.sh"];

/** Internal knobs of the deploy script and the workflows: documented in infra/README.md, not for a fork. */
export const INTERNAL_KNOBS = [
  "SQL_DATABASE",
  "SQL_APP_USER",
  "WEB_PUBSUB_HUB",
  "POLLER_DIST",
  "WEB_DIR",
  "DEPLOY_RETRY_SLEEP",
  "SQLCMD_VERSION",
  "TAG",
  "APP_VERSION",
  "PHOTOS_STORAGE_ACCOUNT",
  "NEED_FIREWALL_FOR_USER",
];
/** GitHub's own names: the token, the run, the runner. */
const isGitHubOwn = (name: string) => /^(GITHUB|RUNNER)_/.test(name) || name === "GITHUB_TOKEN";

const NAME = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+";

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** What the pipeline reads from the repository settings and the environment of a deploy. */
function namesRead(): { settings: string[]; environments: string[] } {
  const settings: string[] = [];
  const environments: string[] = [];
  for (const file of SOURCES) {
    const code = read(file);
    for (const m of code.matchAll(new RegExp(`\\b(?:vars|secrets)\\.(${NAME})\\b`, "g")))
      settings.push(m[1] ?? "");
    for (const m of code.matchAll(new RegExp(`readEnvironmentVariable\\('(${NAME})'`, "g")))
      settings.push(m[1] ?? "");
    for (const m of code.matchAll(new RegExp(`\\$\\{(${NAME}):[-?]`, "g")))
      settings.push(m[1] ?? "");
    for (const m of code.matchAll(/^\s*environment:\s*([a-z][a-z-]*)\s*$/gm))
      environments.push(m[1] ?? "");
    for (const m of code.matchAll(/^\s*environment:\s*\n\s*name:\s*([a-z][a-z-]*)\s*$/gm))
      environments.push(m[1] ?? "");
  }
  return {
    settings: unique(settings.filter((name) => !isGitHubOwn(name))),
    environments: unique(environments),
  };
}

/** The capitalised names and the environment names a document puts in backticks. */
function namesIn(file: string): { settings: string[]; environments: string[] } {
  const text = read(file);
  const ticks = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
  return {
    settings: unique(ticks.filter((token) => new RegExp(`^${NAME}$`).test(token))),
    environments: unique(
      ticks.filter((token) => /^(?:production|production-infra|preview)$/.test(token)),
    ),
  };
}

describe("docs/deploy-your-own.md and the pipeline", () => {
  const pipeline = namesRead();
  const document = namesIn(WALKTHROUGH);
  const corpus = SOURCES.map(read).join("\n");

  it("finds what the pipeline reads (the scan itself works)", () => {
    for (const name of [
      "AZURE_CLIENT_ID",
      "ALERT_EMAIL",
      "CUSTOM_DOMAIN",
      "SQL_SERVER_ID",
      "CI_SQL_SA_PASSWORD",
    ])
      expect(pipeline.settings, name).toContain(name);
    expect(pipeline.environments).toEqual(["preview", "production", "production-infra"]);
  });

  it("names every variable and secret the pipeline reads, apart from the internal knobs", () => {
    const missing = pipeline.settings.filter(
      (name) => !INTERNAL_KNOBS.includes(name) && !document.settings.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("names only settings the pipeline reads", () => {
    const unknown = document.settings.filter(
      (name) => !pipeline.settings.includes(name) && !new RegExp(`\\b${name}\\b`).test(corpus),
    );
    expect(unknown).toEqual([]);
  });

  it("names every environment the workflows use, and no other", () => {
    expect(document.environments).toEqual(pipeline.environments);
  });

  it("names the three country settings and the resource group", () => {
    for (const name of ["FOOD_SOURCES", "OFF_COUNTRY", "DEFAULT_LOCALE", "AZURE_RESOURCE_GROUP"])
      expect(document.settings, name).toContain(name);
  });

  it("keeps the internal knobs out of the walkthrough, because they are not a fork's to set", () => {
    const leaked = INTERNAL_KNOBS.filter((name) => document.settings.includes(name));
    expect(leaked).toEqual([]);
  });

  it("describes the first release, the custom domain and the token in the order that works", () => {
    const text = read(WALKTHROUGH);
    for (const phrase of [
      "workflow_dispatch",
      "milestone",
      "infra",
      "Key Vault Secrets User",
      "bootstrap-token",
      "35 minutes",
      "before the bootstrap",
    ])
      expect(text, phrase).toContain(phrase);
    const headings = [...text.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`);
    const at = (needle: string) => headings.findIndex((heading) => heading.includes(needle));
    expect(at("first release")).toBeGreaterThanOrEqual(0);
    expect(at("custom domain, before the bootstrap")).toBeGreaterThan(at("first release"));
    expect(at("bootstrap token")).toBeGreaterThan(at("custom domain, before the bootstrap"));
    expect(text).not.toContain("push the tag `v0.1.0`");
  });
});

describe("docs/architecture.md", () => {
  const text = read(ARCHITECTURE);

  it("lists the configuration a different country changes", () => {
    for (const name of [
      "DEFAULT_LOCALE",
      "FOOD_SOURCES",
      "OFF_COUNTRY",
      "OFF_CONTRIBUTE_HOST",
      "AI_DAILY_CAP",
      "AI_EMBED_DAILY_CAP",
      "AI_EMBED_BACKFILL_DAILY_CAP",
    ])
      expect(text, name).toContain(name);
  });

  it("names the three interfaces and where their registries are", () => {
    for (const name of [
      "GlucoseSource",
      "FoodSource",
      "FoodContributor",
      "AiProvider",
      "createSourceFactory",
      "registerFoodSource",
      "aiProviders",
    ])
      expect(text, name).toContain(name);
  });
});

describe("the settings the architecture note lists are read in code", () => {
  const walk = (directory: string): string[] =>
    readdirSync(path.join(root, directory)).flatMap((entry) => {
      const file = `${directory}/${entry}`;
      if (entry === "node_modules" || entry === ".next") return [];
      return statSync(path.join(root, file)).isDirectory() ? walk(file) : [file];
    });
  const sources = ["web/src", "poller/src", "shared/src"]
    .flatMap(walk)
    .filter((file) => /\.[cm]?tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map(read)
    .join("\n");

  it.each([
    "DEFAULT_LOCALE",
    "FOOD_SOURCES",
    "OFF_COUNTRY",
    "OFF_CONTRIBUTE_HOST",
    "AI_DAILY_CAP",
    "AI_EMBED_DAILY_CAP",
    "AI_EMBED_BACKFILL_DAILY_CAP",
  ])("%s", (name) => {
    expect(new RegExp(`\\b(?:process\\.env|env)\\.${name}\\b`).test(sources), name).toBe(true);
  });
});

describe("repository paths the documents cite", () => {
  const written = [WALKTHROUGH, ARCHITECTURE, ...GUIDES];
  const TOP = "(?:web|poller|shared|infra|docs|fixtures|evals|scripts|\\.github)";

  function citedPaths(file: string): string[] {
    const text = read(file);
    const cited: string[] = [];
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const token = (m[1] ?? "").trim();
      if (new RegExp(`^${TOP}/[\\w./@\\[\\]()-]+$`).test(token)) cited.push(token);
      else if (/^(?:[\w-]+\.(?:md|json|yml|yaml|js|mjs|ts)|\.env\.example|LICENSE)$/.test(token))
        if (
          /^(?:README\.md|CONTRIBUTING\.md|CLAUDE\.md|AGENTS\.md|\.env\.example|LICENSE|eslint\.config\.js)$/.test(
            token,
          )
        )
          cited.push(token);
    }
    for (const m of text.matchAll(/\]\(((?!https?:|#|mailto:)[^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = m[1] ?? "";
      cited.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), target)));
    }
    return unique(cited);
  }

  const isPlaceholder = (cited: string) => /[<>*{}]/.test(cited) || cited.endsWith("/");

  it.each(written)("%s cites only paths that exist", (file) => {
    const missing = citedPaths(file)
      .filter((cited) => !isPlaceholder(cited))
      .filter((cited) => !existsSync(path.join(root, cited)));
    expect(missing).toEqual([]);
  });

  it("checks directories with a trailing slash too", () => {
    const text = [WALKTHROUGH, ARCHITECTURE, ...GUIDES].map(read).join("\n");
    const dirs = [
      ...text.matchAll(/`((?:web|poller|shared|infra|docs|fixtures)\/[\w./-]*\/)`/g),
    ].map((m) => m[1] ?? "");
    expect(dirs.filter((dir) => !dir.includes("<") && !existsSync(path.join(root, dir)))).toEqual(
      [],
    );
  });
});

describe("CONTRIBUTING.md and README.md", () => {
  const contributing = read("CONTRIBUTING.md");
  const readme = read("README.md");
  const boundary = "Frejsi never calculates, suggests or displays insulin doses";

  it("links both plugin guides", () => {
    expect(contributing).toContain("docs/plugins/food-source.md");
    expect(contributing).toContain("docs/plugins/glucose-source.md");
  });

  it("keeps the DCO heading", () => {
    expect(contributing).toMatch(/^## Developer Certificate of Origin$/m);
  });

  it("explains the review rules", () => {
    for (const phrase of [
      ".github/copilot-instructions.md",
      "ci",
      "Codex",
      "good first issue",
      "needs-owner",
    ])
      expect(contributing, phrase).toContain(phrase);
  });

  it.each([
    ["README.md", readme],
    ["CONTRIBUTING.md", contributing],
  ])("%s keeps the insulin boundary sentence", (_name, text) => {
    expect(text).toContain(boundary);
  });

  it("README.md keeps one status sentence of the agreed form", () => {
    const status = readme.split("\n").filter((line) => line.startsWith("> **Status:"));
    expect(status).toHaveLength(1);
    expect(status[0]).toMatch(
      /^> \*\*Status: v\d+\.\d+\.\d+ is implemented; v\d+\.\d+\.\d+ is live at .+\*\*$/,
    );
  });

  it("README.md speaks to a person with diabetes and the people around them", () => {
    expect(readme).toContain("a person with diabetes and the people around them");
  });

  it("links the plans and the issues as the roadmap", () => {
    expect(readme).toContain("docs/superpowers/plans/");
    expect(readme).toMatch(/github\.com\/[^/]+\/frejsi\/issues/);
  });
});

describe("the documents written for forks name no real installation", () => {
  const files = [WALKTHROUGH, ARCHITECTURE, ...GUIDES, "CONTRIBUTING.md", "README.md"];
  // The README status line carries the address of the installation that is live; nothing else may.
  const withoutStatus = (text: string) =>
    text
      .split("\n")
      .filter((line) => !line.startsWith("> **Status:"))
      .join("\n");

  it.each(files)("%s carries neither the owner's domain nor address", (file) => {
    const text = withoutStatus(read(file));
    expect(text).not.toMatch(/jepsen\.ninja/i);
    expect(text).not.toMatch(/nicklas@/i);
  });
});
