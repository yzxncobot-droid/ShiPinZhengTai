# Base44 Dev Environment — Yzu视频

PNPM monorepo: React/Vite frontend (`artifacts/yzu-video`) + Express API (`artifacts/api-server`).

## Run

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

- Web (preview): host port **3000** → Vite dev server.
- API: internal `api:8080`; the Vite server proxies `/api` → `http://api:8080` (single origin).
- DB: local `postgres:16` with self-signed SSL. A one-shot `pg-certs` service generates the certs (owned by uid 999) into a shared `pgcerts` volume at startup; `db` mounts it read-only. (Bind-mounting certs from the host fails because git leaves them root-owned and Postgres rejects keys it can't exclusively read.)

## How it boots (service order)

1. `db` — Postgres, healthchecked.
2. `setup` — one-shot `pnpm install --frozen-lockfile` (writes `node_modules` into the bind-mounted repo, shared by all services).
3. `migrate` — one-shot `drizzle-kit push --force` against the local DB to create the schema. Uses `NODE_TLS_REJECT_UNAUTHORIZED=0` because `lib/db/drizzle.config.ts` hardcodes `ssl: true` and the local cert is self-signed. Runs after `db` is healthy and `setup` completes.
4. `api` — `pnpm --filter @workspace/api-server run dev` (esbuild bundle once → `node dist/index.mjs`). **No file watcher** — restart the `api` service after backend edits, then `reload_preview`.
5. `web` — `pnpm --filter @workspace/yzu-video run dev` (Vite HMR, live reload).

## Secrets

External credentials (Neon DB, Supabase ×3, TemanQRIS, Upstash Redis) are **optional for boot** — the app degrades gracefully without them. They are delivered via `/run/base44/app.env` (last `env_file` entry, always wins over `.env.base44-defaults`).

- `NEON_DATABASE_URL` — when provided, the app prefers it over the local `DATABASE_URL` (`lib/db/src/index.ts`: `NEON_DATABASE_URL ?? DATABASE_URL`).
- `SESSION_SECRET` — JWT signing secret; a dev placeholder is used until provided.
- Supabase / TemanQRIS / Upstash — see `replit.md` for the full list. Without them, uploads/payments/sessions-cache are disabled but the UI renders.

## Notes / quirks

- `lib/db/src/index.ts` hardcodes `ssl: { rejectUnauthorized: false }`, so the local Postgres must run with SSL on (hence the self-signed cert). Do not disable SSL on the `db` service.
- `artifacts/yzu-video/vite.config.ts` requires `PORT` and `BASE_PATH` env vars or it throws.
- The Replit-only Vite plugins (cartographer, dev-banner) are skipped because `REPL_ID` is unset.
- Frontend auth uses a Bearer token from `localStorage` (not cookies), so the single-origin proxy is sufficient.
