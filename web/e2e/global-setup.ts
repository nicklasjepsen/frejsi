// Before any flow: a browser to drive, then an empty database, `prisma migrate deploy` as the
// release runs it, and `pnpm seed` exactly as a developer runs it (plan §8).
import { execFileSync } from "node:child_process";
import path from "node:path";

import { SHARED, WEB, bin, databaseName, withDatabase } from "./env";

function run(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  execFileSync(file, args, { cwd, env, stdio: ["pipe", "pipe", "inherit"], encoding: "utf8" });
}

/** SQL on the server's `master`, through the Prisma CLI `shared/` already carries. */
function onMaster(url: string, sql: string): void {
  execFileSync(bin(SHARED, "prisma"), ["db", "execute", "--stdin", "--url", url], {
    cwd: SHARED,
    input: sql,
    stdio: ["pipe", "pipe", "inherit"],
  });
}

export default function globalSetup(): void {
  // release.yml runs `pnpm --filter ./web test:e2e` with no separate install step; a no-op when
  // the browser is already there.
  run(bin(WEB, "playwright"), ["install", "chromium"], WEB);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const name = databaseName(url);
  if (!name.endsWith("_e2e")) throw new Error("the e2e only ever recreates an _e2e database");
  onMaster(
    withDatabase(url, "master"),
    `IF DB_ID('${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END; CREATE DATABASE [${name}]; ALTER DATABASE [${name}] SET COMPATIBILITY_LEVEL = 170;`,
  );
  run(bin(SHARED, "prisma"), ["migrate", "deploy"], SHARED);
  run(bin(WEB, "tsx"), ["--require", path.join(WEB, "e2e/clock.cjs"), "scripts/seed.ts"], WEB, {
    ...process.env,
    NODE_ENV: "development",
  });
}
