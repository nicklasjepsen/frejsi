// Before any flow: a browser to drive, then an empty database, `prisma migrate deploy` as the
// release runs it, and `pnpm seed` exactly as a developer runs it (plan §8). Then the local
// `source-connect` stub, which the run's teardown closes.
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import {
  SHARED,
  SOURCE_CONNECT_KEY,
  SOURCE_CONNECT_PORT,
  WEB,
  bin,
  databaseName,
  withDatabase,
} from "./env";

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

/** What the stub saw of a call: the shape only, never the address or the secret. */
export interface StubCall {
  purpose: string | null;
  type: string | null;
  spaceId: string | null;
}

const answer = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
};

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * A loopback stand-in for the poller's `source-connect` function (v0.7.0 plan task 3). A pump body
 * (`purpose: "pump"`) with the function key gets a `ConnectPumpResult`: `ok` with a fictional
 * versioned `pump-<spaceId>` reference and no boluses in the last day, or `bad-credentials` for the
 * token `e2e-wrong-token`. Anything else is `unreachable`, so a glucose connect never succeeds by
 * accident. `GET /calls` lists the shape of every call so far, for the spec to check. Nothing is
 * logged and nothing leaves the machine.
 */
function startSourceConnectStub(
  port: number,
  key: string,
): Promise<{ close: () => Promise<void> }> {
  const calls: StubCall[] = [];
  const reply = async (request: IncomingMessage): Promise<[number, unknown]> => {
    if (request.method === "GET" && request.url === "/calls") return [200, calls];
    if (request.method !== "POST" || request.url !== "/api/source-connect") return [404, {}];
    if (request.headers["x-functions-key"] !== key) return [401, {}];
    const body = await readJson(request);
    const call = {
      purpose: text(body?.purpose),
      type: text(body?.type),
      spaceId: text(body?.spaceId),
    };
    calls.push(call);
    if (call.purpose !== "pump" || call.type !== "nightscout" || !call.spaceId) {
      return [200, { result: "unreachable" }];
    }
    if (body?.token === "e2e-wrong-token") return [200, { result: "bad-credentials" }];
    return [
      200,
      { result: "ok", secretRef: `pump-${call.spaceId}/e2e0fictional`, recentBoluses: 0 },
    ];
  };
  const server = createServer((request, response) => {
    reply(request)
      .then(([status, body]) => {
        answer(response, status, body);
      })
      .catch(() => {
        response.writeHead(500).end();
      });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
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

  const stub = await startSourceConnectStub(SOURCE_CONNECT_PORT, SOURCE_CONNECT_KEY);
  return () => stub.close();
}
