// Run the deployable bundle away from the workspace, as the deploy job receives it: copied with
// symlinks dereferenced, as the GitHub artifact delivers it, so missing traced dependencies, static
// assets or links must fail here rather than resolving from the development checkout. It starts the
// bundle's root server.js, the entry Static Web Apps runs (scripts/prepare-standalone.ts).
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const web = process.cwd();
const isolated = mkdtempSync(path.join(tmpdir(), "frejsi-standalone-"));
cpSync(path.join(web, ".next/standalone"), isolated, { recursive: true, dereference: true });
// As the Static Web Apps upload leaves it: the warm-up probe file only in the root public/, not in
// web/public/. The root server.js must mirror it, or the probe check in e2e/build.spec.ts fails.
rmSync(path.join(isolated, "web/public/.swa"), { recursive: true, force: true });
mkdirSync(path.join(isolated, "public/.swa"), { recursive: true });
writeFileSync(path.join(isolated, "public/.swa/health.html"), "healthy");
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
