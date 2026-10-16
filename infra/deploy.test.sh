#!/usr/bin/env bash
# The Node harness puts stubbed az/sqlcmd/pnpm/docker/curl on PATH. No Azure calls.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test infra/test/deploy.test.mjs
