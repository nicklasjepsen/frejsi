// Run the deployable bundle away from the workspace: missing traced dependencies must fail here,
// rather than resolving from the development node_modules. Static assets are copied as at deploy.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const web = process.cwd();
const isolated = mkdtempSync(path.join(tmpdir(), "frejsi-standalone-"));
cpSync(path.join(web, ".next/standalone"), isolated, { recursive: true, verbatimSymlinks: true });
const app = path.join(isolated, "web");
cpSync(path.join(web, ".next/static"), path.join(app, ".next/static"), { recursive: true });
cpSync(path.join(web, "public"), path.join(app, "public"), { recursive: true });
const child = spawn(
  process.execPath,
  ["--require", path.join(web, "e2e/clock.cjs"), path.join(app, "server.js")],
  {
    cwd: app,
    stdio: "inherit",
    env: { ...process.env, NODE_PATH: "", HOSTNAME: "127.0.0.1" },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  rmSync(isolated, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
