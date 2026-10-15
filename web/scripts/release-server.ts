// Run the deployable bundle away from the workspace, exactly as built: missing traced dependencies
// or static assets must fail here, rather than resolving from the development checkout. It starts
// the bundle's root server.js, the entry Static Web Apps runs (scripts/prepare-standalone.ts).
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const web = process.cwd();
const isolated = mkdtempSync(path.join(tmpdir(), "frejsi-standalone-"));
cpSync(path.join(web, ".next/standalone"), isolated, { recursive: true, verbatimSymlinks: true });
const child = spawn(
  process.execPath,
  ["--require", path.join(web, "e2e/clock.cjs"), path.join(isolated, "server.js")],
  {
    cwd: isolated,
    stdio: "inherit",
    env: { ...process.env, NODE_PATH: "", HOSTNAME: "127.0.0.1" },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  rmSync(isolated, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
