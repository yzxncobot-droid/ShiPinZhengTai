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
2. `setup` — one-shot `pnpm install --no-frozen-lockfile` (writes `node_modules` into the bind-mounted repo, shared by all services).
3. `migrate` — one-shot `drizzle-kit push --force` against the local DB to create the schema. Uses `NODE_TLS_REJECT_UNAUTHORIZED=0` because `lib/db/drizzle.config.ts` hardcodes `ssl: true` and the local cert is self-signed. Runs after `db` is healthy and `setup` completes.
4. `api` — `pnpm --filter @workspace/api-server run dev` (esbuild bundle once → `node dist/index.mjs`). **No file watcher** — restart the `api` service after backend edits, then `reload_preview`.
5. `web` — `pnpm --filter @workspace/yzu-video run dev` (Vite HMR, live reload).

## Payment system (BuatQris + Manual)

The app has **two payment methods**, both crediting the wallet through a single
`creditVerifiedTopup()` function (`artifacts/api-server/src/lib/topup-verification.ts`):

### 1. Automatic — BuatQris
- Provider: **BuatQris** (`https://api.buatqris.site`).
- `POST /api/topup/create` → backend calls BuatQris `api_create_qris` with the
  server-side `BUATQRIS_SECRET_TOKEN` → returns a dynamic QR + `transaction_id`.
- `POST /api/webhooks/buatqris` (public, signature-verified via
  `X-BuatQris-Signature` HMAC-SHA256 on the raw body) → the **primary** crediting
  path. Handles `payment.success` / `payment.expired` / `payment.failed`.
- `GET /api/topup/:id/status` — read-only status reflection (never credits).
- No polling-based crediting. The webhook is the sole source of truth.

### 2. Manual — static QRIS + proof upload
- `POST /api/topup/manual` → creates a pending payment (no QRIS generation).
- `POST /api/topup/:id/upload-proof` → attaches a proof image (uploaded via
  `/api/upload/payment-proof` to Supabase). Status stays `pending`.
- Admin dashboard (`/admin/payments` → Manual tab) → Konfirmasi/Tolak.
- Konfirmasi → `creditVerifiedTopup()` (same single credit path).
- Tolak → status `rejected` (no credit).

### Security model
- `creditVerifiedTopup()` is the ONLY function that adds wallet balance.
- Anti-double-credit: Postgres advisory lock + duplicate-reference guard.
- Webhook signature verified with raw body (never re-stringified).
- Amount + transaction_id + payment_method validated on every webhook.
- Secret token never sent to frontend.
- Admin confirm is idempotent (repeated clicks don't double-credit).

## Secrets

External credentials (Neon DB, BuatQris, Supabase ×3, Cloudflare KV) are
**optional for boot** — the app degrades gracefully without them. They are
delivered via `/run/base44/app.env` (last `env_file` entry, always wins over
`.env.base44-defaults`).

- `NEON_DATABASE_URL` — when provided, the app prefers it over the local `DATABASE_URL`.
- `SESSION_SECRET` — JWT signing secret; a dev placeholder is used until provided.
- `BUATQRIS_ACCOUNT_ID` / `BUATQRIS_SECRET_TOKEN` / `BUATQRIS_WEBHOOK_SECRET` —
  required for the automatic QRIS payment flow. All server-only.
- `PUBLIC_BASE_URL` — public site URL used to construct the BuatQris webhook
  callback URL (`PUBLIC_BASE_URL + /api/webhooks/buatqris`). Falls back to
  `BASE44_PUBLIC_HOST_SUFFIX` when not set. The callback URL is shown on the
  admin BuatQris config page (`/admin/buatqris`).
- Supabase / Upstash — see above. Without them, uploads/payments-cache are
  disabled but the UI renders.

## Notes / quirks

- `lib/db/src/index.ts` hardcodes `ssl: { rejectUnauthorized: false }`, so the local Postgres must run with SSL on (hence the self-signed cert). Do not disable SSL on the `db` service.
- `artifacts/yzu-video/vite.config.ts` requires `PORT` and `BASE_PATH` env vars or it throws.
- The Replit-only Vite plugins (cartographer, dev-banner) are skipped because `REPL_ID` is unset.
- Frontend auth uses a Bearer token from `localStorage` (not cookies), so the single-origin proxy is sufficient.
- The `BASE44_PUBLIC_HOST_SUFFIX` env var is passed to the `api` service so it can construct the public webhook/callback URL for BuatQris as a fallback when `PUBLIC_BASE_URL` is not set.
- Manual QRIS image: admin uploads it via Settings → Konfigurasi QRIS (stored in `settings.qris_image`, served from MEDIA Supabase).
