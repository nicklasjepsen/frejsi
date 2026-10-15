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

export const boundaries = [
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
        {
          selector: "TemplateElement[value.raw=/dexcom\\.com|ShareWebServices/i]",
          message: "The Dexcom host lives in shared/src/glucose/dexcom-share/ only (plan §2).",
        },
      ],
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
      ],
    },
  },
  {
    name: "frejsi/boundaries/dexcom-share",
    files: ["shared/src/glucose/dexcom-share/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[object.property.name="event"][property.name=/^(create|createMany|createManyAndReturn|upsert|update|updateMany|delete|deleteMany)$/]',
          message: "emit() in shared/src/events/emit.ts is the only writer of Event (plan §5).",
        },
      ],
    },
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
