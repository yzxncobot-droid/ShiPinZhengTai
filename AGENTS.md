# Base44 Dev Environment — Yzu视频

PNPM monorepo: React/Vite frontend (`artifacts/yzu-video`) + Express API (`artifacts/api-server`).

## Run

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

- Web (preview): host port **3000** → Vite dev server.
- API: internal `api:8080`; the Vite server proxies `/api` → `http://api:8080` (single origin).
- DB: local `postgres:16` with self-signed SSL (certs in `.base44/pg-certs/`).

## How it boots (service order)

1. `db` — Postgres, healthchecked.
2. `setup` — one-shot `pnpm install --no-frozen-lockfile` (writes `node_modules` into the bind-mounted repo, shared by all services).
3. `migrate` — one-shot `drizzle-kit push --force` against the local DB to create the schema. Uses `NODE_TLS_REJECT_UNAUTHORIZED=0` because `lib/db/drizzle.config.ts` hardcodes `ssl: true` and the local cert is self-signed.
4. `api` — `pnpm --filter @workspace/api-server run dev` (esbuild bundle once → `node dist/index.mjs`). **No file watcher** — restart the `api` service after backend edits, then `reload_preview`.
5. `web` — `pnpm --filter @workspace/yzu-video run dev` (Vite HMR, live reload).

## Secrets

External credentials (Neon DB, Supabase ×3, TemanQRIS, Upstash Redis) are **optional for boot** — the app degrades gracefully without them. They are delivered via `/run/base44/app.env` (last `env_file` entry, always wins over `.env.base44-defaults`).

- `NEON_DATABASE_URL` — when provided, the app prefers it over the local `DATABASE_URL` (`lib/db/src/index.ts`: `NEON_DATABASE_URL ?? DATABASE_URL`).
- `SESSION_SECRET` — JWT signing secret; a dev placeholder is used until provided.
- Supabase / TemanQRIS / Upstash — see `replit.md` for the full list. Without them, uploads/payments/sessions-cache are disabled but the UI renders.

## Notes / quirks

- `lib/db/src/index.ts` hardcodes `ssl: { rejectUnauthorized: false }`, so the local Postgres must run with SSL on (hence the self-signed cert). Do not disable SSL on the `db` service.
- The `db` service uses a custom entrypoint wrapper (`.base44/db-entrypoint.sh`) that copies the bind-mounted self-signed certs into a writable `/certs` with `postgres`-owned `0600`/`0644` perms before starting Postgres. This is required because git does not track file ownership/mode, so a fresh clone would otherwise land with `root:root 0644` certs that Postgres rejects ("private key file has group or world access"). Do not remove the wrapper or revert to bind-mounting `/certs` directly.
- `artifacts/yzu-video/vite.config.ts` requires `PORT` and `BASE_PATH` env vars or it throws.
- The Replit-only Vite plugins (cartographer, dev-banner) are skipped because `REPL_ID` is unset.
- Frontend auth uses a Bearer token from `localStorage` (not cookies), so the single-origin proxy is sufficient.
