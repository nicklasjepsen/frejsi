# The Next.js standalone server. Build context: the repository root.
FROM node:22-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.34.7
WORKDIR /app
# Manifests first so the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY poller/package.json poller/
COPY evals/package.json evals/
COPY shared/prisma shared/prisma
# `prisma generate` (shared's postinstall) reads the schema, which names DATABASE_URL; it never connects.
ENV DATABASE_URL="sqlserver://build:1433;database=build;user=sa;password=build;encrypt=true"
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter ./web build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The standalone output already holds .next/static and public (web/scripts/prepare-standalone.ts).
COPY --from=build --chown=node:node /app/web/.next/standalone ./
USER node
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "web/server.js"]
