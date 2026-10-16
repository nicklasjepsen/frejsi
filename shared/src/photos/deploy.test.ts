import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const baseFakes = path.join(root, "infra/test/fakes");
const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function deploy(existing: boolean, failure = "", account = "stfictionphotos", discovered = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "frejsi-photo-deploy-"));
  temporaryDirectories.push(dir);
  for (const folder of ["bin", "log", "repo/poller/dist", "repo/web/.next/standalone"])
    mkdirSync(path.join(dir, folder), { recursive: true });
  writeFileSync(path.join(dir, "repo/poller/dist/index.js"), "// fictional build");
  writeFileSync(path.join(dir, "repo/web/.next/standalone/server.js"), "// fictional build");
  const log = path.join(dir, "log/calls.log");
  writeFileSync(log, "");
  // Every Azure command runs against the existing fake, plus these photo responses.
  writeFileSync(
    path.join(dir, "bin/az"),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1 $2" = "resource list" ] && [[ " $* " == *" Microsoft.Storage/storageAccounts "* ]]; then
  printf 'az %s\\n' "$*" >> "$FAKE_LOG"
  printf '%s' "$PHOTO_DISCOVERED"
elif [ "$1 $2 $3" = "storage account show-connection-string" ]; then
  printf 'az %s\\n' "$*" >> "$FAKE_LOG"
  if [ "$PHOTO_FAILURE" = "read" ]; then exit 3; fi
  if [ "$PHOTO_FAILURE" != "empty" ]; then printf '%s' 'DefaultEndpointsProtocol=https;AccountName=stfictionphotos;AccountKey=FICTIONAL_PHOTO_KEY;EndpointSuffix=core.windows.net'; fi
elif [ "$1 $2 $3" = "keyvault secret show" ] && [[ " $* " == *" blob-connection-string "* ]]; then
  printf 'az %s\\n' "$*" >> "$FAKE_LOG"
  printf '%s' 'DefaultEndpointsProtocol=https;AccountName=stfictionphotos;AccountKey=FICTIONAL_PHOTO_KEY;EndpointSuffix=core.windows.net'
else
  exec "$PHOTO_BASE_FAKE" "$@"
fi
`,
    { mode: 0o700 },
  );
  const result = spawnSync("bash", [path.join(root, "infra/deploy.sh")], {
    cwd: path.join(dir, "repo"),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}/bin:${baseFakes}:${process.env.PATH ?? ""}`,
      PHOTO_BASE_FAKE: path.join(baseFakes, "az"),
      PHOTO_FAILURE: failure,
      PHOTO_DISCOVERED: discovered,
      FAKE_LOG: log,
      FAKE_LOG_DIR: path.join(dir, "log"),
      FAKE_EXISTING_SECRETS: `database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key${existing ? " blob-connection-string" : ""}`,
      AZURE_SUBSCRIPTION_ID: "00000000-0000-0000-0000-000000000000",
      AZURE_RESOURCE_GROUP: "fictional",
      APP_VERSION: "v0.2.0",
      ALERT_EMAIL: "alerts@frejsi.example",
      PHOTOS_STORAGE_ACCOUNT: account,
    },
  });
  return { result, log: readFileSync(log, "utf8"), dir };
}

describe("photo deploy using fake Azure only", () => {
  it("creates the blob secret once and supplies the app setting without leaking it", () => {
    const { result, log, dir } = deploy(false);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(log).toContain("storage account show-connection-string");
    expect(log).toMatch(/keyvault secret set .*blob-connection-string/);
    const settings = JSON.parse(
      readFileSync(path.join(dir, "log/swa-appsettings.json"), "utf8"),
    ) as { properties: Record<string, string> };
    expect(settings.properties.BLOB_CONNECTION_STRING).toContain("AccountKey=FICTIONAL_PHOTO_KEY");
    expect(log + result.stdout + result.stderr).not.toContain("FICTIONAL_PHOTO_KEY");
  });
  it("discovers the tagged account on first release without extra workflow configuration", () => {
    const { result, log, dir } = deploy(false, "", "", "stfictionphotos");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(log).toContain("tags.purpose=='photos'");
    expect(log).toContain("storage account show-connection-string");
    const settings = JSON.parse(
      readFileSync(path.join(dir, "log/swa-appsettings.json"), "utf8"),
    ) as { properties: Record<string, string> };
    expect(settings.properties.BLOB_CONNECTION_STRING).toContain("AccountKey=FICTIONAL_PHOTO_KEY");
  });
  it("rejects ambiguous discovery before reading account credentials", () => {
    const { result, log } = deploy(false, "", "", "stfictionphotos\nstotherphotos");
    expect(result.status).not.toBe(0);
    expect(log).not.toContain("storage account show-connection-string");
  });
  it("reuses the existing connection string on later releases", () => {
    const { result, log, dir } = deploy(true, "", "");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(log).not.toContain("storage account show-connection-string");
    expect(log).not.toContain("keyvault secret set");
    const settings = JSON.parse(
      readFileSync(path.join(dir, "log/swa-appsettings.json"), "utf8"),
    ) as { properties: Record<string, string> };
    expect(settings.properties.BLOB_CONNECTION_STRING).toContain("AccountKey=FICTIONAL_PHOTO_KEY");
  });
  it.each(["read", "empty"])(
    "stops on %s failure before creating a secret or replacing settings",
    (failure) => {
      const { result, log } = deploy(false, failure);
      expect(result.status).not.toBe(0);
      expect(log).not.toContain("keyvault secret set");
      expect(log).not.toMatch(/az rest --method put/);
    },
  );
});
