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

## Telegram Video Storage & Streaming (isolated module)

An **additive, isolated module** — no existing video system, schema, API, or UI
was changed. Uses **Telegram Bot API only** (HTTP-based) with just
`TELEGRAM_BOT_TOKEN` — **no MTProto, no GramJS, no API ID/API Hash, no Session**.

### Architecture
- **DB**: 4 tables — `telegram_sources`, `telegram_videos`, `telegram_sync_logs`,
  `telegram_import_logs`. Relational (source → many videos). No limit on source count.
  `telegram_videos` stores metadata only — video binary stays in Telegram.
- **Backend**: `src/lib/telegram/{client,indexer,streamer}.ts` + `src/routes/telegram.ts`.
  All Bot API calls go to `https://api.telegram.org/bot<token>/<method>` via `fetch`.
  No native dependencies — the `telegram` (GramJS) package was removed.
- **Frontend**: `src/pages/admin/telegram-sources.tsx` (admin dashboard),
  `src/pages/admin/telegram-import.tsx` (import guide),
  `src/pages/telegram-videos.tsx` (catalog), `src/pages/telegram-video-detail.tsx`
  (player), `src/lib/telegram-api.ts` (API helper).
- **Single-origin wiring**: streaming goes through `/api/telegram-videos/:id/stream`,
  proxied by Vite to the Express API — bot token never reaches the frontend.

### Video ingestion — webhook + import queue (no history scanning)
Bot API cannot read message history, so videos arrive via **webhook**:
1. Admin sets up webhook (`POST /api/admin/telegram/webhook/setup` → `setWebhook`).
2. Telegram sends updates to `POST /api/telegram/webhook` when the bot receives videos
   (new messages in groups/channels, or forwarded videos for old imports).
3. The webhook extracts metadata → creates an `telegram_import_logs` entry (pending) →
   returns 200 immediately (async processing).
4. A background **queue processor** (5 s poll) picks up pending entries, upserts the
   video (duplicate-protected via `telegramSourceId + telegramMessageId` unique index),
   and updates the log status. Failed entries retry with exponential backoff (max 5
   attempts, max 60 s between retries).

### Streaming — Bot API getFile + HTTP proxy
- `GET /api/telegram-videos/:id/stream` → access check → `getFile(file_id)` → proxy
  `https://api.telegram.org/file/bot<token>/<file_path>` with Range headers → 206 Partial Content.
- File is **piped** (never loaded fully into RAM).
- If `file_id` expired: tries `forwardMessage` to refresh it, then retries `getFile`.
- **Bot API getFile limit: 20 MB** — a Telegram-imposed external limitation. Larger
  files return a clear error explaining the limit (not an application limit).

### Secrets (all optional for boot)
- `TELEGRAM_BOT_TOKEN` — Bot token from @BotFather (server-only). The ONLY credential.
- `TELEGRAM_WEBHOOK_SECRET` — Optional secret for webhook verification (server-only).
- No `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, or `TELEGRAM_SESSION` needed.

### API endpoints (all new, namespaced)
- Admin sources: `/api/admin/telegram/sources` (CRUD), `/:id/test`, `/:id/sync`, `/health`
- Admin webhook: `/api/admin/telegram/webhook/setup` (POST), `/webhook/info` (GET), `/webhook` (DELETE)
- Admin queue: `/api/admin/telegram/import-queue` (GET), `/import-queue/stats` (GET), `/import-queue/:id/retry` (POST)
- Admin bot: `/api/admin/telegram/bot-info` (GET)
- Public: `/api/telegram-videos` (list), `/:id` (detail), `/:id/stream` (Range streaming)
- Webhook: `POST /api/telegram/webhook` (public, no auth)

### How to verify
1. Set `TELEGRAM_BOT_TOKEN` → Admin → Telegram Storage → Set Webhook.
2. Admin → Add Source (chat ID) → Test Connection → 🟢 Connected.
3. Forward a video to the bot → Import Queue shows it → video appears in `/telegram-videos`.
4. Open video → native `<video>` player streams via Range (play/pause/seek).
5. Existing features (login, videos, payments, etc.) must remain unaffected.

### File size limits (no artificial MAX_SIZE)
- Standard Bot API (`api.telegram.org`): **20 MB** — Telegram-imposed, not application limit.
- Local Bot API Server (`TELEGRAM_API_BASE` set): **up to 2 GB** — drop-in replacement,
  same bot token, no API ID/Hash/Session needed.
- The streamer has NO `MAX_VIDEO_SIZE` constant. The limit comes from Telegram's
  infrastructure. If `getFile` returns "file is too big", the streamer returns HTTP 413
  with a clear message explaining the Bot API limit and how to set `TELEGRAM_API_BASE`.

### Bug fixes applied (2026-09-05) — streaming & health audit

- **Range streaming (streamer.ts)**: Replaced `response.ok` check with explicit
  `response.status` inspection. `response.ok` is true for both 200 and 206, so it
  could not confirm Telegram honored a Range. Now: if upstream returns 206, the
  Content-Range and Content-Length are verified against the requested range
  (mismatch → 502, no fake Content-Range). If upstream returns 200 (ignored the
  Range), the streamer skips the leading bytes and serves only the requested
  range as a genuine 206 — never a fake 206, never the full file for a range
  request. Unsatisfiable ranges return 416.
- **Cache-Control**: Changed from `public, max-age=3600` to `private, no-store`.
  Videos may have permission/premium/private access; a public CDN cache could
  serve a private video to an unauthorized user.
- **Local Bot API (client.ts)**: Split `isLocalBotApiServer()` (env existence)
  into `isLocalBotApiConfigured()` (config only) and `checkLocalBotApiHealth()`
  (real getMe request). ENV existence is no longer treated as proof the server
  is active. The old function is kept as a deprecated alias.
- **Health check (routes/telegram.ts)**: The `components` object now distinguishes
  `telegramApi`, `webhook`, `database`, `indexer`, `streaming`, and `localBotApi`.
  Added `streamingMode` (`STANDARD_BOT_API` | `LOCAL_BOT_API` | `NOT_AVAILABLE`)
  and `largeFileStreaming` (boolean). Large-file support is only reported when
  the Local Bot API Server is actually reachable, not merely configured.
- **Duplicate protection (indexer.ts)**: Added `onConflictDoUpdate` targeting the
  `(telegramSourceId, telegramMessageId)` unique index on the video insert, so
  concurrent identical webhooks create one row at the DB level (last line of
  defense). The existing select-then-update logic is preserved.
- **file_id refresh**: Confirmed the refresh updates by `telegramVideosTable.id`
  (primary key), not by `telegramChatId` — only the relevant video changes.
- **No artificial file size limit**: No `MAX_FILE_SIZE` constant; the limit comes
  from Telegram's infrastructure (20 MB standard, 2 GB local server).
- **Tests**: Added `src/lib/telegram/__tests__/telegram.test.ts` (13 tests)
  covering all 10 audit scenarios. `processQueueItem` is now exported for testing.

### Bug fixes applied (2026-09-05)
- **Document video detection**: `extractVideoMetadata` now checks `message.document`
  with video mime type (previously only `message.video` / `message.animation`).
- **File ID refresh scope**: Streamer updates file_id by video primary key, not by
  `telegramChatId` — prevents corrupting other videos from the same chat.
- **Queue retry status**: Fixed `attempts >= MAX ? "failed" : "failed"` ternary (both
  branches were "failed") → now `"pending"` for retryable, `"failed"` for permanent.
- **Schema**: Added `telegramFileUniqueId`, `status` (active/error/unavailable),
  `thumbnailWidth`, `thumbnailHeight` columns + indexes on `telegramMessageId` and
  `telegramFileUniqueId`.
- **Thumbnail extraction**: Indexer now extracts thumbnail file_id, width, height.
- **Streamer error handling**: Separated "file is too big" (HTTP 413) from expired
  file_id (HTTP 502 + refresh attempt) and rate limit (HTTP 429). No stack traces
  exposed to users.
- **Video status check**: Stream endpoint rejects videos with `error`/`unavailable` status.
- **Health endpoint**: Added `botUsername`, `activeSources`, `lastSuccessfulImport`,
  `lastFailedImport`, `lastErrorDate` to the admin health response.
- **Video player**: Added `playsInline` and `preload="metadata"` attributes.
- **Configurable API base**: `TELEGRAM_API_BASE` env var for Local Bot API Server support.

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

External credentials (Neon DB, BuatQris, Supabase ×3, Layerbase Valkey) are
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
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — Layerbase Valkey (Redis-compatible
  REST API) used for sessions, caching, and view buffering. Optional — without
  them the app degrades gracefully (no session invalidation or caching).
  Token is server-only, never sent to the frontend or logged.
- Supabase — see above. Without them, uploads/payments-cache are
  disabled but the UI renders.

## Notes / quirks

- `lib/db/src/index.ts` hardcodes `ssl: { rejectUnauthorized: false }`, so the local Postgres must run with SSL on (hence the self-signed cert). Do not disable SSL on the `db` service.
- `artifacts/yzu-video/vite.config.ts` requires `PORT` and `BASE_PATH` env vars or it throws.
- The Replit-only Vite plugins (cartographer, dev-banner) are skipped because `REPL_ID` is unset.
- Frontend auth uses a Bearer token from `localStorage` (not cookies), so the single-origin proxy is sufficient.
- The `BASE44_PUBLIC_HOST_SUFFIX` env var is passed to the `api` service so it can construct the public webhook/callback URL for BuatQris as a fallback when `PUBLIC_BASE_URL` is not set.
- Manual QRIS image: admin uploads it via Settings → Konfigurasi QRIS (stored in `settings.qris_image`, served from MEDIA Supabase).
