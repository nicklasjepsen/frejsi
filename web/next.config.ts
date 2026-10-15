import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Azure Static Web Apps hybrid Next.js deploys the standalone output (plan §2, §10).
  output: "standalone",
  // The monorepo root, so the standalone bundle traces files from shared/ as well.
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  // @frejsi/shared is consumed as TypeScript source.
  transpilePackages: ["@frejsi/shared"],
  // Native engines and the App Insights SDK stay outside the webpack bundle.
  serverExternalPackages: ["@prisma/client", "applicationinsights", "sharp"],
  // The workspace hoists packages to the root node_modules (.npmrc node-linker=hoisted); include
  // sharp's loader and its native libvips packages, which the trace cannot see.
  outputFileTracingIncludes: {
    "/*": ["../node_modules/sharp/**/*", "../node_modules/@img/**/*"],
  },
  reactStrictMode: true,
};

export default nextConfig;
