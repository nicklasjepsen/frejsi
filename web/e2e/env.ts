// What the e2e run and the app under test share (plan §8): the port, the origin, the database
// and the version. `playwright.config.ts` reads these and puts them into the environment, so the
// global setup and the workers see the same values.
import path from "node:path";

// web/ is CommonJS (no "type": "module"), and Playwright loads these files as such.

export const WEB = path.resolve(__dirname, "..");
export const SHARED = path.resolve(WEB, "../shared");
export const OUTPUT = path.join(WEB, "e2e/.output");
export const SERVER_LOG = path.join(OUTPUT, "server.log");

export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BLOB_PORT = PORT + 1;
export const ORIGIN = `http://localhost:${String(PORT)}`;

/** The release sets the tag as `TAG`; the build check compares `/api/health` with it. */
export function expectedVersion(env = process.env): string {
  return env.NEXT_PUBLIC_APP_VERSION ?? env.TAG ?? "e2e";
}

/**
 * The run's own database beside the one `DATABASE_URL` names (`frejsi_test` becomes
 * `frejsi_test_e2e`): the global setup drops and recreates it, so a developer's data is never it.
 */
export function e2eDatabaseUrl(url: string): string {
  const parts = url.split(";");
  const index = parts.findIndex((part) => /^database=/i.test(part.trim()));
  const current = index >= 0 ? (parts[index]?.split("=")[1]?.trim() ?? "") : "frejsi";
  if (current.endsWith("_e2e")) return url;
  return withDatabase(url, `${current}_e2e`);
}

/** The same server and credentials with another database. */
export function withDatabase(url: string, database: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error("unsafe database name");
  const parts = url.split(";").filter((part) => !/^database=/i.test(part.trim()));
  const [server, ...rest] = parts;
  return [server, `database=${database}`, ...rest].join(";");
}

export function databaseName(url: string): string {
  const part = url.split(";").find((p) => /^database=/i.test(p.trim()));
  const name = part?.split("=")[1]?.trim() ?? "";
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("unsafe database name");
  return name;
}
