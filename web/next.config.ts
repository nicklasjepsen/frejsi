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
  serverExternalPackages: ["@prisma/client", "applicationinsights"],
  reactStrictMode: true,
};

export default nextConfig;
