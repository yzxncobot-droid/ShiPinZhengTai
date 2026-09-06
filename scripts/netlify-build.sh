#!/usr/bin/env bash
# Netlify build script — builds the API server (esbuild), frontend (Vite),
# and runs database migrations against the external Neon PostgreSQL.
set -e

echo "=== Installing dependencies ==="
pnpm install --no-frozen-lockfile

echo "=== Building API server (esbuild bundle) ==="
pnpm --filter @workspace/api-server run build

echo "=== Building frontend (Vite) ==="
pnpm --filter @workspace/yzu-video run build

# ── Database migrations ──────────────────────────────────────────────────
# Only run if NEON_DATABASE_URL is set (required for the app to function).
if [ -n "$NEON_DATABASE_URL" ]; then
  echo "=== Running database migrations ==="
  pnpm --filter @workspace/db run push-force
  node artifacts/api-server/dist/migrate.mjs
  echo "=== Migrations complete ==="
else
  echo "⚠️  NEON_DATABASE_URL not set — skipping database migrations."
  echo "    Set it in Netlify → Settings → Environment variables for the app to work."
fi

echo "=== Build complete ==="
