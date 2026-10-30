#!/usr/bin/env bash
set -euo pipefail

pnpm install --no-frozen-lockfile

pnpm --filter @workspace/api-server run build
PORT="${PORT:-3000}" BASE_PATH="${BASE_PATH:-/}" NODE_ENV=production \
  pnpm --filter @workspace/yzu-video run build

if [ -n "${NEON_DATABASE_URL:-}" ]; then
  (cd lib/db && pnpm exec drizzle-kit push --force --config ./drizzle.config.ts) \
    || echo "[netlify-build] drizzle-kit push failed (non-fatal)"
  node artifacts/api-server/dist/migrate.mjs \
    || echo "[netlify-build] startup migrations failed (non-fatal)"
else
  echo "[netlify-build] NEON_DATABASE_URL not set — skipping migrations"
fi
