# The Functions app (timer + source-connect). Build context: the repository root.
FROM node:22-bookworm AS build
RUN npm install -g pnpm@10.34.7
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY poller/package.json poller/
COPY evals/package.json evals/
COPY shared/prisma shared/prisma
ENV DATABASE_URL="sqlserver://build:1433;database=build;user=sa;password=build;encrypt=true"
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter ./poller build

FROM mcr.microsoft.com/azure-functions/node:4-node22
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \
    FUNCTIONS_WORKER_RUNTIME=node
COPY --from=build /app/poller/dist /home/site/wwwroot
