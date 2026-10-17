import fs from "node:fs";
import { seedTime } from "./scripts/seed";

import { defineConfig } from "@playwright/test";

import {
  BLOB_PORT,
  ORIGIN,
  OUTPUT,
  PORT,
  SERVER_LOG,
  e2eDatabaseUrl,
  expectedVersion,
} from "./e2e/env";

// The release e2e (plan §8): the isolated standalone app with the job's `DATABASE_URL` (its
// `_e2e` sibling) and `FAKE_GLUCOSE_SOURCE=1`; the global setup migrates and seeds. release.yml
// only: it needs a SQL Server, a production build and a browser.
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL is required for the e2e run (plan §8)");
const databaseUrl = e2eDatabaseUrl(baseUrl);
const version = expectedVersion();

// The global setup, the workers and the seed's `@frejsi/shared` client all read these.
process.env.DATABASE_URL = databaseUrl;
process.env.APP_ORIGIN = ORIGIN;
process.env.FAKE_AI_PROVIDER = "1";
process.env.E2E_APP_VERSION = version;
// A stable afternoon on today's local date, shared by browser, app and seed.
process.env.E2E_NOW = seedTime(new Date(), 15, 13);

fs.mkdirSync(OUTPUT, { recursive: true });

const appProjects = [
  "simple-mode.spec.ts",
  "viewer.spec.ts",
  "pwa.spec.ts",
  "meal-detail.spec.ts",
  "history.spec.ts",
  "ai.spec.ts",
  "now-theme.spec.ts",
  "manual-readings.spec.ts",
  "source-settings.spec.ts",
  // v0.6.0: symbols.spec.ts arrives with the curve lane; a name without a file matches nothing.
  "symptoms.spec.ts",
  "recipe.spec.ts",
  "symbols.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.output/results",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: ORIGIN,
    locale: "da-DK",
    timezoneId: "Europe/Copenhagen",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "release", testMatch: ["seed.spec.ts", "build.spec.ts"] },
    {
      name: "phone",
      dependencies: ["release"],
      testMatch: appProjects,
      use: { viewport: { width: 360, height: 780 } },
    },
    {
      name: "desktop",
      dependencies: ["phone"],
      testMatch: appProjects,
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "desktop-food",
      testMatch: ["food.spec.ts", "contribution.spec.ts"],
      dependencies: ["desktop"],
      use: { viewport: { width: 1280, height: 800 } },
    },
    // Last: everything the server wrote while the flows ran.
    {
      name: "server-log",
      testMatch: ["server-log.spec.ts"],
      dependencies: ["desktop-food"],
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx e2e/blob-server.ts",
      url: `http://127.0.0.1:${String(BLOB_PORT)}/health`,
      reuseExistingServer: false,
    },
    {
      // The log is the evidence for the no-PII check (server-log.spec.ts).
      command: `pnpm exec tsx scripts/release-server.ts > "${SERVER_LOG}" 2>&1`,
      url: `${ORIGIN}/manifest.webmanifest`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        E2E_NOW: process.env.E2E_NOW,
        PORT: String(PORT),
        FOOD_SOURCES: "",
        // A fictional key signed only for the local HTTP fake. Never contacts Azure.
        BLOB_CONNECTION_STRING: `DefaultEndpointsProtocol=http;AccountName=fictional;AccountKey=RmljdGlvbmFs;BlobEndpoint=http://127.0.0.1:${String(BLOB_PORT)}/fictional;`,
        APP_ORIGIN: ORIGIN,
        FAKE_GLUCOSE_SOURCE: "1",
        FAKE_AI_PROVIDER: "1",
        // The OFF correction goes to a local fake: no account, no request to Open Food Facts.
        FAKE_FOOD_CONTRIBUTOR: "1",
        NEXT_PUBLIC_APP_VERSION: version,
        // No Web PubSub: negotiate answers 503 and the client polls (plan §5).
        WEB_PUBSUB_CONNECTION_STRING: "",
        APPLICATIONINSIGHTS_CONNECTION_STRING: "",
      },
    },
  ],
});
