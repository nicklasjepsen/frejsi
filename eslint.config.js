// Flat config for the whole workspace. Each package runs `eslint .` from its own directory and
// ESLint finds this file by walking up; `files` patterns below are relative to the repo root.
//
// The boundary rules are exported on their own so shared/src/events/lint-boundaries.test.ts can
// prove them against probe files without type information.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const DANISH_LETTERS = "[æøåÆØÅ]";

/** Files that may import the in-memory fakes: tests, the seed and the poller CLI. */
const FAKE_CONSUMERS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/test/**",
  "web/scripts/seed.ts",
  "poller/src/cli.ts",
  "poller/src/sources.ts",
];

const noFakes = {
  group: [
    "**/glucose/fake",
    "**/glucose/fake.js",
    "**/events/memory",
    "**/events/memory.js",
    "**/secrets/memory",
    "**/secrets/memory.js",
  ],
  message:
    "FakeGlucoseSource, MemoryEventSink and MemorySecrets are for tests, the seed and the CLI only. Production code uses the interfaces (plan §2).",
};

/** Only emit() writes the events table (plan §5). */
const eventWrite = {
  selector:
    'MemberExpression[object.property.name="event"][property.name=/^(create|createMany|createManyAndReturn|upsert|update|updateMany|delete|deleteMany)$/]',
  message: "emit() in shared/src/events/emit.ts is the only writer of Event (plan §5).",
};

/** The Dexcom host and service path live in the adapter folder only (plan §2). */
const dexcomHost = [
  {
    selector: "Literal[value=/dexcom\\.com|ShareWebServices/i]",
    message: "The Dexcom host lives in shared/src/glucose/dexcom-share/ only (plan §2).",
  },
  {
    selector: "TemplateElement[value.raw=/dexcom\\.com|ShareWebServices/i]",
    message: "The Dexcom host lives in shared/src/glucose/dexcom-share/ only (plan §2).",
  },
];

/** The Nightscout paths and auth header live in the adapter folder only (plan §2, §5). */
const NIGHTSCOUT_LITERAL = "api\\/v1\\/(?:entries|treatments)|verifyauth|api-secret";
const nightscoutMessage =
  "The Nightscout paths and auth header live in shared/src/glucose/nightscout/ only (plan §2).";
const nightscoutProtocol = [
  { selector: `Literal[value=/${NIGHTSCOUT_LITERAL}/i]`, message: nightscoutMessage },
  { selector: `TemplateElement[value.raw=/${NIGHTSCOUT_LITERAL}/i]`, message: nightscoutMessage },
];

/**
 * Hard rule: glucose sources are read-only. The one caller of fetch under shared/src/glucose/ is
 * the Dexcom and Nightscout transports, whose allow-lists hold the reads Frejsi makes; a new source adds its own
 * transport file to the ignores below, with its own allow-list, instead of calling fetch from its
 * adapter.
 */
const glucoseFetch = [
  'CallExpression[callee.name="fetch"]',
  'CallExpression[callee.property.name="fetch"]',
].map((selector) => ({
  selector,
  message:
    "Glucose sources are read-only: send requests through the allow-listed transport (shared/src/glucose/dexcom-share/transport.ts), never fetch directly (CLAUDE.md hard rules).",
}));
const glucoseFetchCallers = [
  "shared/src/glucose/dexcom-share/transport.ts",
  "shared/src/glucose/nightscout/transport.ts",
  "shared/src/glucose/**/*.test.ts",
  "shared/src/glucose/**/test-server.ts",
];

/**
 * The pump cycle knows `PumpSource`, not an adapter (v0.7.0 plan §5): nothing under
 * shared/src/pump/ imports from shared/src/glucose/nightscout/. Its own rule, so it adds to the
 * folder's import restrictions instead of replacing them.
 */
const pumpAdapterMessage =
  "shared/src/pump/ knows PumpSource, not Nightscout: the adapter is built in poller/src/sources.ts (v0.7.0 plan §5).";
const pumpBoundaryRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    if (!context.filename.replaceAll("\\", "/").includes("/shared/src/pump/")) return {};
    const check = (source) => {
      if (
        source &&
        typeof source.value === "string" &&
        /glucose\/nightscout(?:\/|$)/.test(source.value)
      )
        context.report({ node: source, message: pumpAdapterMessage });
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

/** AI boundaries use a separate rule so every existing restriction remains active. */
const aiBoundaryRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const file = context.filename.replaceAll("\\", "/");
    const test = /\.test\.tsx?$/.test(file);
    const aiFolder = /\/(shared|web)\/src\/ai\//.test(file);
    const fakeConsumer =
      test || /\/(seed|cli|registry)\.ts$/.test(file) || file.includes("/evals/");
    const registryCaller =
      test ||
      file.includes("/evals/") ||
      /\/web\/src\/ai\/provider\.ts$/.test(file) ||
      /\/poller\/src\/functions\/(enrich-foods|weekly-insight)\.ts$/.test(file);
    const service = /\/shared\/src\/ai\/(search|parse|estimate|insight|recipe)\//.test(file);
    const infrastructure =
      /\/shared\/src\/ai\/(capped|tool-loop)\.ts$/.test(file) ||
      /\/shared\/src\/ai\/(anthropic|voyage|azure-openai|ollama)\//.test(file);
    const rawNames = ["Reading", "reading", "readingsBetween", "HistoryRepository"];
    const memoryNames = [
      "FakeAiProvider",
      "MemoryAiCallRepository",
      "MemoryInsightRepository",
      "MemoryPushSubscriptionRepository",
    ];
    const adapterNames = ["AnthropicProvider", "AzureOpenAiProvider", "OllamaProvider"];
    const constructors = new Map();
    const registryNames = new Set(["aiProviders"]);
    const registryNamespaces = new Set();
    const name = (node) =>
      node?.type === "Identifier" ? node.name : node?.type === "Literal" ? node.value : undefined;
    const property = (node) =>
      node?.type === "MemberExpression" ? name(node.property) : undefined;
    const report = (node, message) => context.report({ node, message });
    const vendorLiteral = (node, value) => {
      if (test || typeof value !== "string") return;
      const vendors = [
        ["anthropic", /@anthropic-ai\/sdk|claude-/],
        ["voyage", /api\.voyageai\.com|voyage-/],
        ["azure-openai", /\.openai\.azure\.com|text-embedding/],
        ["ollama", /localhost:11434|127\.0\.0\.1:11434|mxbai/],
      ];
      for (const [folder, pattern] of vendors)
        if (pattern.test(value) && !file.includes(`/shared/src/ai/${folder}/`))
          report(node, "Vendor SDKs, hosts and model ids stay in their AI adapter.");
    };
    return {
      Literal(node) {
        vendorLiteral(node, node.value);
      },
      TemplateElement(node) {
        vendorLiteral(node, node.value.raw);
      },
      ImportDeclaration(node) {
        const source = String(node.source.value);
        const names = node.specifiers.map((specifier) => name(specifier.imported));
        if (
          aiFolder &&
          (names.some((value) =>
            ["Reading", "readingsBetween", "HistoryRepository"].includes(value),
          ) ||
            /(^|\/)glucose(\/|$)/.test(source) ||
            /insights\/week-input/.test(source) ||
            /lib\/history/.test(source))
        )
          report(node, "Raw readings stay outside AI code; pass aggregate contracts only.");
        if (
          !fakeConsumer &&
          (names.some((value) =>
            [
              "FakeAiProvider",
              "MemoryAiCallRepository",
              "MemoryInsightRepository",
              "MemoryPushSubscriptionRepository",
            ].includes(value),
          ) ||
            /(?:^|\/)ai\/fake(?:\.js)?$/.test(source) ||
            (aiFolder && /^\.\/fake(?:\.js)?$/.test(source)))
        )
          report(
            node,
            "Fake and memory implementations are for tests, seed, CLI, registry and evals only.",
          );
        for (const specifier of node.specifiers) {
          if (name(specifier.imported) === "aiProviders") registryNames.add(specifier.local.name);
          const imported = name(specifier.imported);
          if (adapterNames.includes(imported) || imported === "CappedAiProvider")
            constructors.set(specifier.local.name, imported);
          if (
            specifier.type === "ImportDefaultSpecifier" &&
            /(?:^|\/)(anthropic|azure-openai|ollama)\//.test(source)
          )
            constructors.set(specifier.local.name, "adapter");
          if (specifier.type === "ImportNamespaceSpecifier")
            registryNamespaces.add(specifier.local.name);
        }
        if (
          /\/ai\/(anthropic|voyage|azure-openai|ollama)(\/|$)/.test(source) &&
          !test &&
          !/\/shared\/src\/ai\//.test(file)
        )
          report(node, "AI adapters are constructed through the registry only.");
      },
      TSQualifiedName(node) {
        if (aiFolder && rawNames.includes(name(node.right)))
          report(node, "Raw readings stay outside AI code; pass aggregate contracts only.");
      },
      NewExpression(node) {
        const constructor =
          node.callee.type === "Identifier"
            ? (constructors.get(node.callee.name) ?? node.callee.name)
            : property(node.callee);
        if (
          !test &&
          (adapterNames.includes(constructor) || constructor === "adapter") &&
          !file.endsWith("/shared/src/ai/registry.ts")
        )
          report(node, "Construct AI adapters in the registry only.");
        if (
          !test &&
          constructor === "CappedAiProvider" &&
          file.includes("/web/") &&
          !file.endsWith("/web/src/ai/provider.ts")
        )
          report(node, "Construct capped providers in the web provider factory only.");
      },
      MemberExpression(node) {
        const prop = property(node);
        if (aiFolder && rawNames.includes(prop))
          report(node, "Raw readings stay outside AI code; pass aggregate contracts only.");
        if (!fakeConsumer && memoryNames.includes(prop))
          report(
            node,
            "Fake and memory implementations are for tests, seed, CLI, registry and evals only.",
          );
        if (
          property(node.object) === "aiCall" &&
          /^(create|createMany|createManyAndReturn|upsert|update|updateMany|delete|deleteMany)$/.test(
            prop,
          ) &&
          !file.endsWith("/shared/src/ai/calls-prisma.ts")
        )
          report(node, "PrismaAiCallRepository is the sole AiCall writer.");
      },
      CallExpression(node) {
        const callee = node.callee;
        const method = property(callee);
        if (
          !registryCaller &&
          ((callee.type === "Identifier" && registryNames.has(callee.name)) ||
            (method === "aiProviders" && registryNamespaces.has(name(callee.object))))
        )
          report(node, "Use the named registry callers: web provider factory, two timers, evals.");
        if (
          ["complete", "vision", "embed"].includes(method) &&
          !test &&
          !service &&
          !infrastructure &&
          !file.includes("/evals/")
        ) {
          const embedCaller =
            method === "embed" &&
            (/\/shared\/src\/food\/lookup\.ts$/.test(file) ||
              /\/poller\/src\/functions\/enrich-foods\.ts$/.test(file));
          if (!embedCaller)
            report(node, "Call providers through AI services, not routes or timers.");
        }
      },
    };
  },
};

const danishLettersMessage =
  "Code under shared/ and poller/ is English; Danish belongs in a message file or a documented data file (CLAUDE.md).";
/** Reports a string or template chunk holding æ, ø or å. Same pattern as the web rule below. */
const danishLettersRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const pattern = new RegExp(DANISH_LETTERS);
    return {
      Literal(node) {
        if (typeof node.value === "string" && pattern.test(node.value))
          context.report({ node, message: danishLettersMessage });
      },
      TemplateElement(node) {
        if (pattern.test(node.value.raw)) context.report({ node, message: danishLettersMessage });
      },
    };
  },
};

export const boundaries = [
  {
    name: "frejsi/boundaries/db",
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    plugins: {
      "frejsi-db": {
        rules: {
          vendor: {
            meta: { type: "problem", schema: [] },
            create(context) {
              if (context.filename.replaceAll("\\", "/").includes("/shared/src/db/")) return {};
              return {
                Literal(node) {
                  if (
                    typeof node.value === "string" &&
                    /^(?:@prisma\/adapter-mssql|mssql|tedious)(?:\/|$)/.test(node.value)
                  )
                    context.report({
                      node,
                      message:
                        "Only shared/src/db/ imports the SQL Server driver adapter; use createPrismaFromEnv.",
                    });
                },
              };
            },
          },
        },
      },
    },
    rules: { "frejsi-db/vendor": "error" },
  },
  {
    name: "frejsi/boundaries/push",
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    plugins: {
      "frejsi-push": {
        rules: {
          vendor: {
            meta: { type: "problem", schema: [] },
            create(context) {
              if (context.filename.replaceAll("\\", "/").endsWith("/shared/src/push/sink.ts"))
                return {};
              return {
                Literal(node) {
                  if (typeof node.value === "string" && /^web-push(?:\/|$)/.test(node.value))
                    context.report({
                      node,
                      message: "Only WebPushSink imports web-push; publish through emit().",
                    });
                },
              };
            },
          },
        },
      },
    },
    rules: { "frejsi-push/vendor": "error" },
  },
  {
    name: "frejsi/boundaries/pump",
    files: ["shared/src/pump/**/*.ts"],
    plugins: { "frejsi-pump": { rules: { adapter: pumpBoundaryRule } } },
    rules: { "frejsi-pump/adapter": "error" },
  },
  {
    name: "frejsi/boundaries/ai",
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    plugins: { "frejsi-ai": { rules: { boundaries: aiBoundaryRule } } },
    rules: { "frejsi-ai/boundaries": "error" },
  },
  {
    name: "frejsi/boundaries",
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@azure/web-pubsub",
              message: "Only shared/src/events/ talks to Web PubSub; use EventSink (plan §2).",
            },
            {
              name: "@azure/keyvault-secrets",
              message: "Only shared/src/secrets/ talks to Key Vault; use Secrets (plan §2).",
            },
            {
              name: "applicationinsights",
              message:
                "Only shared/src/telemetry.ts talks to App Insights; use trackEvent (plan §9).",
            },
          ],
          patterns: [
            noFakes,
            {
              group: ["**/shared/src/**", "**/../shared/**"],
              message: "Import domain code from @frejsi/shared, not by relative path (plan §2).",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", eventWrite, ...dexcomHost, ...nightscoutProtocol],
    },
  },
  {
    name: "frejsi/boundaries/fake-consumers",
    files: FAKE_CONSUMERS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@azure/web-pubsub", message: "Only shared/src/events/ talks to Web PubSub." },
            {
              name: "@azure/keyvault-secrets",
              message: "Only shared/src/secrets/ talks to Key Vault.",
            },
            {
              name: "applicationinsights",
              message: "Only shared/src/telemetry.ts talks to App Insights.",
            },
          ],
          patterns: [
            {
              group: ["**/shared/src/**", "**/../shared/**"],
              message: "Import domain code from @frejsi/shared, not by relative path (plan §2).",
            },
          ],
        },
      ],
    },
  },
  {
    name: "frejsi/boundaries/shared-internal",
    // Inside shared/, relative imports between its own modules are the normal thing.
    files: ["shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@azure/web-pubsub", message: "Only shared/src/events/ talks to Web PubSub." },
            {
              name: "@azure/keyvault-secrets",
              message: "Only shared/src/secrets/ talks to Key Vault.",
            },
            {
              name: "applicationinsights",
              message: "Only shared/src/telemetry.ts talks to App Insights.",
            },
          ],
          patterns: [noFakes],
        },
      ],
    },
  },
  {
    name: "frejsi/boundaries/shared-tests",
    files: ["shared/**/*.test.ts", "shared/test/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@azure/web-pubsub", message: "Only shared/src/events/ talks to Web PubSub." },
            {
              name: "@azure/keyvault-secrets",
              message: "Only shared/src/secrets/ talks to Key Vault.",
            },
            {
              name: "applicationinsights",
              message: "Only shared/src/telemetry.ts talks to App Insights.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "frejsi/boundaries/pubsub",
    files: ["shared/src/events/pubsub.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@azure/keyvault-secrets",
              message: "Only shared/src/secrets/ talks to Key Vault.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "frejsi/boundaries/keyvault",
    files: ["shared/src/secrets/keyvault.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@azure/web-pubsub", message: "Only shared/src/events/ talks to Web PubSub." },
          ],
        },
      ],
    },
  },
  {
    name: "frejsi/boundaries/telemetry",
    files: ["shared/src/telemetry.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    name: "frejsi/boundaries/emit",
    files: ["shared/src/events/emit.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/dexcom\\.com|ShareWebServices/i]",
          message: "The Dexcom host lives in shared/src/glucose/dexcom-share/ only (plan §2).",
        },
        ...nightscoutProtocol,
      ],
    },
  },
  {
    name: "frejsi/boundaries/dexcom-share",
    files: ["shared/src/glucose/dexcom-share/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", eventWrite, ...nightscoutProtocol] },
  },
  {
    name: "frejsi/boundaries/nightscout",
    files: ["shared/src/glucose/nightscout/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", eventWrite, ...dexcomHost] },
  },
  {
    name: "frejsi/boundaries/glucose-read-only",
    files: ["shared/src/glucose/**/*.ts"],
    ignores: [
      "shared/src/glucose/dexcom-share/**",
      "shared/src/glucose/nightscout/**",
      ...glucoseFetchCallers,
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        eventWrite,
        ...dexcomHost,
        ...nightscoutProtocol,
        ...glucoseFetch,
      ],
    },
  },
  {
    name: "frejsi/boundaries/glucose-read-only/dexcom-share",
    files: ["shared/src/glucose/dexcom-share/**/*.ts"],
    ignores: glucoseFetchCallers,
    rules: {
      "no-restricted-syntax": ["error", eventWrite, ...nightscoutProtocol, ...glucoseFetch],
    },
  },
  {
    name: "frejsi/boundaries/glucose-read-only/nightscout",
    files: ["shared/src/glucose/nightscout/**/*.ts"],
    ignores: glucoseFetchCallers,
    rules: { "no-restricted-syntax": ["error", eventWrite, ...dexcomHost, ...glucoseFetch] },
  },
  {
    // The adapters' default `fetch` is wired in these two files and nowhere else in the poller.
    name: "frejsi/boundaries/poller-fetch",
    files: ["poller/src/**/*.ts"],
    ignores: [
      "poller/src/sources.ts",
      "poller/src/source-connect-handler.ts",
      "poller/src/**/*.test.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        eventWrite,
        ...dexcomHost,
        ...nightscoutProtocol,
        {
          selector: 'MemberExpression[object.name="globalThis"][property.name="fetch"]',
          message:
            "A glucose adapter gets its fetch in poller/src/sources.ts or source-connect-handler.ts only (CLAUDE.md hard rules).",
        },
      ],
    },
  },
  {
    // Code in shared/ and poller/ is English too (v0.5.0 plan section 2). The exclusions are data that
    // is Danish on purpose: the Frida dataset, the search fold table, the dosing word list, the AI
    // prompts and the Danish column names of a Dexcom Clarity export. Tests and fixtures are exempt.
    name: "frejsi/boundaries/english-in-shared-and-poller",
    files: ["shared/src/**/*.ts", "poller/src/**/*.ts"],
    ignores: [
      "**/*.test.ts",
      "shared/src/food/frida/data/**",
      "shared/src/food/search.ts",
      "shared/src/dosing-vocabulary.ts",
      "shared/src/ai/guard.ts",
      "shared/src/ai/**/prompt*.ts",
      "shared/src/ai/insight/meal.ts",
      "shared/src/ai/insight/week.ts",
      "shared/src/glucose/import/clarity.ts",
    ],
    // A rule of its own, because a second `no-restricted-syntax` block would replace the boundary
    // selectors that already apply to these files.
    plugins: { "frejsi-english": { rules: { "danish-letters": danishLettersRule } } },
    rules: { "frejsi-english/danish-letters": "error" },
  },
  {
    name: "frejsi/boundaries/english-in-web",
    // UI strings live in web/messages/<locale>/<namespace>.json; code under web/src is English.
    files: ["web/src/**/*.ts", "web/src/**/*.tsx"],
    ignores: ["web/src/**/*.test.ts", "web/src/**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[object.property.name="event"][property.name=/^(create|createMany|createManyAndReturn|upsert|update|updateMany|delete|deleteMany)$/]',
          message: "emit() in shared/src/events/emit.ts is the only writer of Event (plan §5).",
        },
        {
          selector: "Literal[value=/dexcom\\.com|ShareWebServices/i]",
          message: "The Dexcom host lives in shared/src/glucose/dexcom-share/ only (plan §2).",
        },
        ...nightscoutProtocol,
        {
          selector: `Literal[value=/${DANISH_LETTERS}/]`,
          message:
            "Danish belongs in web/messages/da/<namespace>.json; code and copy keys are English (CLAUDE.md).",
        },
        {
          selector: `TemplateElement[value.raw=/${DANISH_LETTERS}/]`,
          message:
            "Danish belongs in web/messages/da/<namespace>.json; code and copy keys are English (CLAUDE.md).",
        },
        {
          selector: `JSXText[value=/${DANISH_LETTERS}/]`,
          message:
            "Danish belongs in web/messages/da/<namespace>.json; code and copy keys are English (CLAUDE.md).",
        },
      ],
    },
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "web/public/**",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js", "*.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  ...boundaries,
  prettier,
);
