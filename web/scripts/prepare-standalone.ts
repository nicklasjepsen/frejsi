// Next's trace misses the generated Prisma engine in pnpm's virtual store. Include the client
// beside its traced package at the same relative path; the isolated release e2e proves it loads.
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");
const requireShared = createRequire(path.join(root, "shared/package.json"));
const generated = path.resolve(
  path.dirname(requireShared.resolve("@prisma/client/package.json")),
  "../../.prisma/client",
);
if (!existsSync(generated)) throw new Error("Run pnpm install to generate the Prisma client first");
cpSync(generated, path.join(root, "web/.next/standalone", path.relative(root, generated)), {
  recursive: true,
});
